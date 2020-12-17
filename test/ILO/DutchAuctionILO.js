const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

describe("FixedPriceILO contract", function() {
    let iloFactoryContract, liquidityTokenContract, ifexEthSwapExchangeContract, assetSwapExchangeContract, templateFixedPriceIloContract, templateSwapExchangeContract, wrappedEtherContract, swapFactoryContract, templateDividendERC20Contract, ifexTokenContract;
    let token0, token1, token3, token4;
    let owner, addr1, addr2, addrs;
  
    beforeEach(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        const ERC20 = await ethers.getContractFactory("ERC20");
        [token0, token1, token3, token4] = await Promise.all(
            new Array(4).fill().map(async (_, i) => {
                const tokenContract = await ERC20.deploy();
                await tokenContract.initializeERC20(`token${i}`, `${i}`, 18, ethers.utils.parseEther("2010"), true);
                return tokenContract;
            })
        );

        const DividendERC20 = await ethers.getContractFactory("DividendERC20");
        templateDividendERC20Contract = await DividendERC20.deploy();

        ifexTokenContract = await DividendERC20.deploy();
        await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, parseEther("2100000000"), ifexTokenContract.address, false);

        const SwapExchange = await ethers.getContractFactory("SwapExchange");
        templateSwapExchangeContract = await SwapExchange.deploy();

        const SwapFactory = await ethers.getContractFactory("SwapFactory");
        swapFactoryContract = await SwapFactory.deploy();

        await swapFactoryContract.initialize_factory(
            parseEther("0.001"), 
            templateSwapExchangeContract.address, 
            templateDividendERC20Contract.address,
            ifexTokenContract.address
        );

        await token0.approve(swapFactoryContract.address, ethers.constants.MaxUint256);
        await token1.approve(swapFactoryContract.address, ethers.constants.MaxUint256);
        await ifexTokenContract.approve(swapFactoryContract.address, ethers.constants.MaxUint256);
        await swapFactoryContract.create_exchange(
            token0.address,
            token1.address,
            parseEther("1"),
            parseEther("1"),
            parseEther("1"),
        );

        const WrappedEther = await ethers.getContractFactory("WrappedEther");
        wrappedEtherContract = await WrappedEther.deploy();

        await wrappedEtherContract.approve(swapFactoryContract.address, ethers.constants.MaxUint256);
        await wrappedEtherContract.deposit({ value: parseEther("10") });
        await swapFactoryContract.create_exchange(
            token0.address,
            wrappedEtherContract.address,
            parseEther("1"),
            parseEther("1"),
            parseEther("1"),
        );

        assetSwapExchangeContract = await ethers.getContractAt(
            "SwapExchange",
            await swapFactoryContract.pair_to_exchange(token0.address, wrappedEtherContract.address)
        );

        ifexEthSwapExchangeContract = await ethers.getContractAt(
            "SwapExchange",
            await swapFactoryContract.pair_to_exchange(wrappedEtherContract.address, ifexTokenContract.address)
        );

        liquidityTokenContract = await ethers.getContractAt(
            "DividendERC20",
            await assetSwapExchangeContract.liquidity_token()
        );

        const FixedPriceILO = await ethers.getContractFactory("FixedPriceILO");
        templateFixedPriceIloContract = await FixedPriceILO.deploy();
    });

    describe("No start date, end date, or soft cap", function() {
        let fixedPriceIlocontract;
        const assetTokenAmount = parseEther("100");
        const startTokensPerEth = parseEther("1");
        const endTokensPerEth = parseEther("50");
        const percentageToLock = parseEther("0.3");
        let startDate, endDate, liquidityUnlockDate;
        const DAY = 60 * 60 * 24;
        beforeEach(async function() {
            const DutchAuctionILO = await ethers.getContractFactory("DutchAuctionILO");
            dutchAuctionIloContract = await DutchAuctionILO.deploy();

            const blockTime = (await ethers.provider.getBlock()).timestamp;
            startDate = blockTime + DAY;
            endDate = blockTime + DAY * 3;
            liquidityUnlockDate = blockTime + DAY * 20;

            await token0.approve(dutchAuctionIloContract.address, ethers.constants.MaxUint256);
            await dutchAuctionIloContract.initialize(
                token0.address,
                assetTokenAmount,
                startTokensPerEth,
                endTokensPerEth,   
                startDate,
                endDate,
                assetSwapExchangeContract.address,
                ifexEthSwapExchangeContract.address,
                percentageToLock,
                wrappedEtherContract.address,
                ifexTokenContract.address,
                liquidityUnlockDate,
                owner.address,
            );
        });

        it("Should initialize", async function () {
            expect(await dutchAuctionIloContract.assetToken()).to.be.equal(token0.address);
            expect(await dutchAuctionIloContract.assetTokenAmount()).to.be.equal(assetTokenAmount);
            expect(await dutchAuctionIloContract.startTokensPerEth()).to.be.equal(startTokensPerEth);
            expect(await dutchAuctionIloContract.endTokensPerEth()).to.be.equal(endTokensPerEth);
            expect(await dutchAuctionIloContract.startDate()).to.be.equal(startDate);
            expect(await dutchAuctionIloContract.endDate()).to.be.equal(endDate);
            expect(await dutchAuctionIloContract.assetSwapExchange()).to.be.equal(assetSwapExchangeContract.address);
            expect(await dutchAuctionIloContract.percentageToLock()).to.be.equal(percentageToLock);
            expect(await dutchAuctionIloContract.wrappedEther()).to.be.equal(wrappedEtherContract.address);
            expect(await dutchAuctionIloContract.creator()).to.be.equal(owner.address);

            expect(await token0.balanceOf(dutchAuctionIloContract.address)).to.be.equal(assetTokenAmount);

            await expect(
                dutchAuctionIloContract.initialize(
                    token0.address,
                    assetTokenAmount,
                    startTokensPerEth,
                    endTokensPerEth,   
                    startDate,
                    endDate,
                    assetSwapExchangeContract.address,
                    ifexEthSwapExchangeContract.address,
                    percentageToLock,
                    wrappedEtherContract.address,
                    ifexTokenContract.address,
                    liquidityUnlockDate,
                    owner.address,
                )
            ).to.be.revertedWith("Already initialized");
        });

        it("Should invest", async function() {
            const depositAmount = parseEther("0.01");
            
            await ethers.provider.send("evm_increaseTime", [DAY * 1]);
            await ethers.provider.send("evm_mine");
            
            await dutchAuctionIloContract.invest({ value: depositAmount });
            
            expect(await ethers.provider.getBalance(dutchAuctionIloContract.address)).to.be.equal(depositAmount);
            expect(await dutchAuctionIloContract.etherDeposited(owner.address)).to.be.equal(depositAmount);
        });

        // it("Should hit hardcap and end ILO", async function() {
        //     const ethHardCap = assetTokenAmount.div(tokensPerEth);

        //     await fixedPriceIlocontract.invest({ value: parseEther(ethHardCap.div(2).toString()) });
        //     expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(false);

        //     await fixedPriceIlocontract.invest({ value: parseEther(ethHardCap.div(2).toString()) });
        //     expect(await fixedPriceIlocontract.totalAssetTokensBought()).to.be.equal(
        //         await fixedPriceIlocontract.assetTokenAmount()
        //     );
        //     expect(await fixedPriceIlocontract.totalAssetTokensBought()).to.be.equal(assetTokenAmount);
        //     expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(true);

        //     await expect(
        //         fixedPriceIlocontract.invest({ value: parseEther(ethHardCap.div(2).toString()) })
        //     ).to.be.revertedWith("ILO has ended");
        // });

        // it("Should not invest more than contract can sell", async function() {
        //     const ethHardCap = assetTokenAmount.div(tokensPerEth);

        //     await expect(
        //         fixedPriceIlocontract.invest({ value: parseEther(ethHardCap.add(1).toString()) }),
        //     ).to.be.revertedWith("Not enough tokens to sell");
        // });

        // it("Should withdraw and add liquidity", async function() {
        //     const ethHardCap = assetTokenAmount.div(tokensPerEth);
        //     const ownerBalanceBefore = await token0.balanceOf(owner.address);

        //     await fixedPriceIlocontract.invest({ value: parseEther(ethHardCap.toString()) });
        //     expect(await wrappedEtherContract.balanceOf(fixedPriceIlocontract.address)).to.be.equal(0);
        //     await fixedPriceIlocontract.withdraw();

        //     expect(await token0.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore.add(assetTokenAmount));
        //     expect(await liquidityTokenContract.balanceOf(fixedPriceIlocontract.address)).to.not.equal(0);

        //     expect(await ethers.provider.getBalance(fixedPriceIlocontract.address)).to.be.equal(
        //         assetTokenAmount
        //             .mul(parseEther("1"))
        //             .div(tokensPerEth)
        //             .mul(parseEther("1").sub(percentageToLock))
        //             .div(parseEther("1"))
        //     );

        //     expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(true);

        //     const addr1EthBalanceBefore = await ethers.provider.getBalance(addr1.address);
        //     await fixedPriceIlocontract.ownerWithdrawFunds(addr1.address);
        //     expect(await ethers.provider.getBalance(addr1.address)).to.be.equal(
        //         addr1EthBalanceBefore.add(
        //             (await fixedPriceIlocontract.totalAssetTokensBought())
        //                 .mul(parseEther("1"))
        //                 .div(tokensPerEth)
        //                 .mul(parseEther("1").sub(percentageToLock))
        //                 .div(parseEther("1"))
        //                 .mul(990)
        //                 .div(1000)
        //         )
        //     );

        //     await expect(fixedPriceIlocontract.ownerWithdrawFunds(addr1.address)).to.be.revertedWith("You have already withdrawn");

        //     await fixedPriceIlocontract.ownerWithdrawLiquidity(addr1.address);
        //     const addr1LiquidityTokenBalance = await liquidityTokenContract.balanceOf(addr1.address);
        //     expect(addr1LiquidityTokenBalance).to.not.equal(0);

        //     await fixedPriceIlocontract.ownerWithdrawLiquidity(addr1.address);
        //     expect(await liquidityTokenContract.balanceOf(addr1.address)).to.be.equal(addr1LiquidityTokenBalance);
        // });
    });

    // describe("With start date, end date, and soft cap", function() {
    //     let fixedPriceIlocontract;
    //     const assetTokenAmount = parseEther("100");
    //     const tokensPerEth = parseEther("5");
    //     const percentageToLock = parseEther("0.3");
    //     const softCap = parseEther("10");
    //     const DAY =  60 * 60 * 24;
    //     beforeEach(async function() {
    //         const FixedPriceILO = await ethers.getContractFactory("FixedPriceILO");
    //         fixedPriceIlocontract = await FixedPriceILO.deploy();

    //         await token0.approve(fixedPriceIlocontract.address, ethers.constants.MaxUint256);
    //         const blockTime = (await ethers.provider.getBlock()).timestamp;
    //         await fixedPriceIlocontract.initialize(
    //             token0.address,
    //             assetTokenAmount,
    //             tokensPerEth,
    //             blockTime + DAY,
    //             blockTime + DAY * 3,
    //             softCap,
    //             assetSwapExchangeContract.address,
    //             ifexEthSwapExchangeContract.address,
    //             percentageToLock,
    //             wrappedEtherContract.address,
    //             ifexTokenContract.address,
    //             blockTime + DAY * 20,
    //             owner.address,
    //         );
    //     });

    //     it("Should not start before startDate", async function() {
    //         const etherDeposit = parseEther("1");

    //         await expect(fixedPriceIlocontract.invest({ value: etherDeposit })).to.be.revertedWith("ILO has not started yet");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 0.95]);
    //         await ethers.provider.send("evm_mine");

    //         await expect(fixedPriceIlocontract.invest({ value: etherDeposit })).to.be.revertedWith("ILO has not started yet");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 0.1]);
    //         await ethers.provider.send("evm_mine");

    //         await fixedPriceIlocontract.invest({ value: etherDeposit });
    //     });

    //     it("Should end with endDate", async function() {
    //         const etherDeposit = parseEther("1");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 2.95]);
    //         await ethers.provider.send("evm_mine");

    //         expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(false);

    //         await ethers.provider.send("evm_increaseTime", [DAY * 0.06]);
    //         await ethers.provider.send("evm_mine");

    //         expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(true);

    //         expect(await fixedPriceIlocontract.hasReachedSoftCap()).to.be.equal(false);
    //     });

    //     it("Should reach softCap", async function() {
    //         const etherDeposit = parseEther("1");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 1]);
    //         await ethers.provider.send("evm_mine");

    //         await fixedPriceIlocontract.invest({ value: etherDeposit });

    //         expect(await fixedPriceIlocontract.hasReachedSoftCap()).to.be.equal(false);

    //         await fixedPriceIlocontract.invest({ value: etherDeposit.mul(10) });

    //         expect(await fixedPriceIlocontract.hasReachedSoftCap()).to.be.equal(true);
    //     });

    //     it("Should not reach softCap then refund investors", async function() {
    //         const etherDeposit = parseEther("1");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 1]);
    //         await ethers.provider.send("evm_mine");

    //         await fixedPriceIlocontract.invest({ value: etherDeposit });

    //         await ethers.provider.send("evm_increaseTime", [DAY * 3]);
    //         await ethers.provider.send("evm_mine");

    //         expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(true);
    //         expect(await fixedPriceIlocontract.hasReachedSoftCap()).to.be.equal(false);

    //         expect(await fixedPriceIlocontract.etherDeposited(owner.address)).to.be.equal(etherDeposit);
    //         await fixedPriceIlocontract.withdraw();

    //         expect(await fixedPriceIlocontract.etherDeposited(owner.address)).to.be.equal(0);

    //         const ownerBalanceBefore = await token0.balanceOf(owner.address);
    //         await fixedPriceIlocontract.ownerWithdrawFunds(owner.address);
    //         expect(await token0.balanceOf(owner.address)).to.be.equal(
    //             ownerBalanceBefore.add(
    //                 assetTokenAmount
    //             )
    //         );
    //     });

    //     it("Should lock liquidity", async function() {
    //         const etherDeposit = parseEther("20");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 1]);
    //         await ethers.provider.send("evm_mine");

    //         await fixedPriceIlocontract.invest({ value: etherDeposit });

    //         expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(true);

    //         await expect(fixedPriceIlocontract.ownerWithdrawLiquidity(addr1.address)).to.be.revertedWith("Liquidity is still locked");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 20]);
    //         await ethers.provider.send("evm_mine");

    //         await fixedPriceIlocontract.withdraw();

    //         await fixedPriceIlocontract.ownerWithdrawLiquidity(addr1.address);
    //         expect(await liquidityTokenContract.balanceOf(addr1.address)).to.be.gt(1);
    //         expect(await liquidityTokenContract.balanceOf(fixedPriceIlocontract.address)).to.be.equal(0);
    //     });

    //     it("Should distribute ifex rewards after owner withdraw", async function() {
    //         const etherDeposit = parseEther("20");

    //         await ethers.provider.send("evm_increaseTime", [DAY * 1]);
    //         await ethers.provider.send("evm_mine");

    //         await fixedPriceIlocontract.invest({ value: etherDeposit });

    //         expect(await fixedPriceIlocontract.hasEnded()).to.be.equal(true);

    //         const ifexDividendsBefore = await ifexTokenContract.balanceOf(ifexTokenContract.address);
    //         expect(ifexDividendsBefore).to.be.equal(0);
    //         await fixedPriceIlocontract.ownerWithdrawFunds(addr1.address);

    //         expect(await ifexTokenContract.balanceOf(ifexTokenContract.address)).to.be.gt(0);

    //         expect(await ifexTokenContract.totalTokenDividends()).to.be.equal(0);
    //         await ifexTokenContract.distributeExcessBalance();

    //         expect(await ifexTokenContract.totalTokenDividends()).to.be.gt(0);
    //     });
    // });
});