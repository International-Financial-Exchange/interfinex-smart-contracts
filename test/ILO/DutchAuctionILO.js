const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

describe("DutchAuctionILO contract", function() {
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

    describe("Functionality", function() {
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

        it("Should invest with surplus amount", async function() {
            await ethers.provider.send("evm_increaseTime", [DAY * 1]);
            await ethers.provider.send("evm_mine");

            const investAmount = (await ethers.provider.getBalance(owner.address)).div(2);
            await dutchAuctionIloContract.invest({ value: investAmount });
            expect(await dutchAuctionIloContract.hasEnded()).to.be.equal(true);

            expect(await dutchAuctionIloContract.totalAssetTokensBought()).to.be.equal(
                await dutchAuctionIloContract.assetTokenAmount()
            );

            expect(await ethers.provider.getBalance(owner.address)).to.be.gt(investAmount);
            expect(await ethers.provider.getBalance(dutchAuctionIloContract.address)).to.be.lt(investAmount);

            await expect(
                dutchAuctionIloContract.invest({ value: parseEther("1") })
            ).to.be.revertedWith("ILO has ended");
        });

        it("Should withdraw owner funds", async function() {
            await ethers.provider.send("evm_increaseTime", [DAY * 1]);
            await ethers.provider.send("evm_mine");

            const ownerBalanceBefore = await token0.balanceOf(owner.address);

            await dutchAuctionIloContract.invest({ value: parseEther("1000") });
            expect(await wrappedEtherContract.balanceOf(dutchAuctionIloContract.address)).to.be.equal(0);
            await dutchAuctionIloContract.withdraw();

            expect(await token0.balanceOf(owner.address)).to.be.equal(ownerBalanceBefore.add(assetTokenAmount));
            expect(await liquidityTokenContract.balanceOf(dutchAuctionIloContract.address)).to.not.equal(0);

            expect(await dutchAuctionIloContract.hasEnded()).to.be.equal(true);

            const addr1EthBalanceBefore = await ethers.provider.getBalance(addr1.address);
            await dutchAuctionIloContract.ownerWithdrawFunds(addr1.address);
            expect(await ethers.provider.getBalance(addr1.address)).to.be.equal(
                addr1EthBalanceBefore.add(
                    (await dutchAuctionIloContract.etherAmountRaised())
                        .mul(parseEther("1").sub(percentageToLock))
                        .div(parseEther("1"))
                        .mul(990)
                        .div(1000)
                )
            );

            await expect(dutchAuctionIloContract.ownerWithdrawFunds(addr1.address)).to.be.revertedWith("You have already withdrawn");
        });
    });

    describe("Security", function() {
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

        it("Should not start before startDate", async function() {
            const etherDeposit = parseEther("1");

            await expect(dutchAuctionIloContract.invest({ value: etherDeposit })).to.be.revertedWith("ILO has not started yet");

            await ethers.provider.send("evm_increaseTime", [DAY * 0.95]);
            await ethers.provider.send("evm_mine");

            await expect(dutchAuctionIloContract.invest({ value: etherDeposit })).to.be.revertedWith("ILO has not started yet");

            await ethers.provider.send("evm_increaseTime", [DAY * 0.1]);
            await ethers.provider.send("evm_mine");

            await dutchAuctionIloContract.invest({ value: etherDeposit });
        });

        it("Should end with endDate", async function() {
            const etherDeposit = parseEther("1");

            await ethers.provider.send("evm_increaseTime", [DAY * 2.95]);
            await ethers.provider.send("evm_mine");

            expect(await dutchAuctionIloContract.hasEnded()).to.be.equal(false);

            await ethers.provider.send("evm_increaseTime", [DAY * 0.06]);
            await ethers.provider.send("evm_mine");

            expect(await dutchAuctionIloContract.hasEnded()).to.be.equal(true);
        });

        it("Should lock liquidity", async function() {
            const etherDeposit = parseEther("1000");

            await ethers.provider.send("evm_increaseTime", [DAY * 1]);
            await ethers.provider.send("evm_mine");

            await dutchAuctionIloContract.invest({ value: etherDeposit });

            expect(await dutchAuctionIloContract.hasEnded()).to.be.equal(true);

            await expect(dutchAuctionIloContract.ownerWithdrawLiquidity(addr1.address)).to.be.revertedWith("Liquidity is still locked");

            await ethers.provider.send("evm_increaseTime", [DAY * 20]);
            await ethers.provider.send("evm_mine");

            await dutchAuctionIloContract.withdraw();

            await dutchAuctionIloContract.ownerWithdrawLiquidity(addr1.address);
            expect(await liquidityTokenContract.balanceOf(addr1.address)).to.be.gt(1);
            expect(await liquidityTokenContract.balanceOf(dutchAuctionIloContract.address)).to.be.equal(0);
        });

        it("Should distribute ifex rewards after owner withdraw", async function() {
            const etherDeposit = parseEther("500");

            await ethers.provider.send("evm_increaseTime", [DAY * 1]);
            await ethers.provider.send("evm_mine");

            await dutchAuctionIloContract.invest({ value: etherDeposit });

            expect(await dutchAuctionIloContract.hasEnded()).to.be.equal(true);

            const ifexDividendsBefore = await ifexTokenContract.balanceOf(ifexTokenContract.address);
            expect(ifexDividendsBefore).to.be.equal(0);
            await dutchAuctionIloContract.ownerWithdrawFunds(addr1.address);

            expect(await ifexTokenContract.balanceOf(ifexTokenContract.address)).to.be.gt(0);

            expect(await ifexTokenContract.totalTokenDividends()).to.be.equal(0);
            await ifexTokenContract.distributeExcessBalance();

            expect(await ifexTokenContract.totalTokenDividends()).to.be.gt(0);
        });
    });
});