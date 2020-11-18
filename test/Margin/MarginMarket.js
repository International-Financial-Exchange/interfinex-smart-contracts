const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

const ONE = ethers.utils.parseEther("1");

const calculateInterestRate = (utilizationRate, multiplier) => Math.pow(utilizationRate * multiplier, 2);
const bigNumToDecimal = bigNum => parseFloat(ethers.utils.formatUnits(bigNum.toString(), 18));;
const DAY = 60 * 60 * 24;

describe("MarginMarket contract", function() {
    let marginMarketContract, templateDividendERC20Contract, ifexTokenContract, liquidityTokenContract, swapMarketContract;
    let token0, token1, token3, token4;
    let addr0, addr1, addr2, addr3, addrs;
  
    beforeEach(async function () {
        [addr0, addr1, addr2, addr3, ...addrs] = await ethers.getSigners();

        ERC20 = await ethers.getContractFactory("ERC20");
        [token0, token1, token3, token4] = await Promise.all(
            new Array(4).fill().map(async (_, i) => {
                const tokenContract = await ERC20.deploy();
                await tokenContract.initializeERC20(`token${i}`, `${i}`, 18, parseEther("210"), true);
                return tokenContract;
            })
        );

        DividendERC20 = await ethers.getContractFactory("DividendERC20");
        templateDividendERC20Contract = await DividendERC20.deploy();

        ifexTokenContract = await DividendERC20.deploy();
        await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, parseEther("2100000000"), ifexTokenContract.address, false);

        SwapExchange = await ethers.getContractFactory("Exchange");
        templateSwapExchangeContract = await SwapExchange.deploy();

        SwapFactory = await ethers.getContractFactory("contracts/Swap/Factory.vy:Factory");
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

        swapMarketContract = await ethers.getContractAt("Exchange", await swapFactoryContract.pair_to_exchange(token0.address, token1.address))

        await token0.approve(swapMarketContract.address, ethers.constants.MaxUint256);
        await token1.approve(swapMarketContract.address, ethers.constants.MaxUint256);
        
        MarginMarket = await ethers.getContractFactory("MarginMarket");
        templateMarginMarketContract = await MarginMarket.deploy();
        marginMarketContract = await MarginMarket.deploy();
        
        await ifexTokenContract.approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await ifexTokenContract.transfer(addr1.address, parseEther("100"));
        await ifexTokenContract.transfer(addr2.address, parseEther("100"));
        await ifexTokenContract.transfer(addr3.address, parseEther("100"));
        await ifexTokenContract.connect(addr1).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await ifexTokenContract.connect(addr2).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await ifexTokenContract.connect(addr3).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await token0.approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await token1.approve(marginMarketContract.address, ethers.constants.MaxUint256);

        await marginMarketContract.initialize(token0.address, token1.address, templateDividendERC20Contract.address, ifexTokenContract.address, swapFactoryContract.address);
        liquidityTokenContract = await ethers.getContractAt("DividendERC20", await marginMarketContract.liquidityToken());
        liquidityTokenContract.approve(marginMarketContract.address, ethers.constants.MaxUint256);
    });

    it("Should initialize margin market", async function() {
        expect(await marginMarketContract.isInitialized()).to.equal(true);
        expect(await marginMarketContract.assetToken()).to.equal(token0.address);
        expect(await marginMarketContract.collateralToken()).to.equal(token1.address);
        expect(await marginMarketContract.collateralToken()).to.not.equal(ethers.constants.AddressZero);
        expect(await marginMarketContract.interestIndex()).to.equal(ONE);
        expect(await marginMarketContract.interestRate()).to.equal(0);
    });

    describe("Trading", function() {
        it("Should deposit asset tokens", async function() {
            const amount = parseEther("1");
            await marginMarketContract.deposit(amount.toString());
    
            expect(await token0.balanceOf(marginMarketContract.address)).to.equal(amount)
            expect(await marginMarketContract.totalReserved()).to.equal(amount);
            expect(await marginMarketContract.totalBorrowed()).to.equal(0);
            expect(await liquidityTokenContract.totalSupply()).to.equal(parseEther("1"));
            expect(await liquidityTokenContract.balanceOf(addr0.address)).to.equal(parseEther("1"));
            expect(await marginMarketContract.interestRate()).to.equal(0);
        });
    
        it("Should withdraw asset tokens", async function() {
            const depositAmount = parseEther("1"); // Asset token
            const withdrawAmount = parseEther("0.5"); // Liquidity token
    
            await marginMarketContract.deposit(depositAmount);
            await marginMarketContract.withdraw(withdrawAmount);
    
            expect(await marginMarketContract.totalReserved()).to.equal(depositAmount.sub(withdrawAmount));
            expect(await token0.balanceOf(marginMarketContract.address)).to.equal(parseEther("0.5"));
            expect(await marginMarketContract.interestIndex()).to.equal(ONE);
        });
    
        it("Should enter position", async function() {
            const depositAmount = parseEther("1"); // Asset token
            await marginMarketContract.deposit(depositAmount);
    
            await marginMarketContract.increasePosition(parseEther("1"), parseEther("0.5"));
    
            const position = await marginMarketContract.account_to_position(addr0.address);
            expect(position.maintenanceMargin).to.equal(parseEther((1.5 * 0.15).toString()).add("20"));
            expect(position.borrowedAmount).to.equal(parseEther("0.5"));
    
            const totalBorrowed = await marginMarketContract.totalBorrowed();
            const totalReserved = await marginMarketContract.totalReserved();
            const interestIndex = await marginMarketContract.interestIndex();
            expect(totalBorrowed).to.equal(parseEther("0.5"));
            expect(totalReserved).to.equal(parseEther("0.5"));
    
            const interestRate = calculateInterestRate(
                bigNumToDecimal(totalBorrowed) / (bigNumToDecimal(totalReserved) + bigNumToDecimal(totalBorrowed)), 
                1
            );
    
            expect(await marginMarketContract.interestRate()).to.equal(parseEther(interestRate.toString()));
            expect(await marginMarketContract.interestIndex()).to.equal(ONE);
    
            await ethers.provider.send('evm_mine');
            await ethers.provider.send('evm_mine');
    
            await marginMarketContract.testAccrueInterest()
            expect(await marginMarketContract.totalBorrowed()).to.equal(
                totalBorrowed
                    .add(parseEther((bigNumToDecimal(totalBorrowed) * interestRate).toString()))
                    .add(parseEther((bigNumToDecimal(totalBorrowed) * interestRate).toString()))
                    .add(parseEther((bigNumToDecimal(totalBorrowed) * interestRate).toString()))
            );
    
            expect(await marginMarketContract.interestIndex()).to.equal(
                interestIndex
                    .add(parseEther((bigNumToDecimal(interestIndex) * interestRate).toString()))
                    .add(parseEther((bigNumToDecimal(interestIndex) * interestRate).toString()))
                    .add(parseEther((bigNumToDecimal(interestIndex) * interestRate).toString()))
            );
    
            expect(await marginMarketContract.totalReserved()).to.equal(totalReserved);
        });
    
        it("Should decrease position", async function() {
            const depositAmount = parseEther("1"); // Asset token
            await marginMarketContract.deposit(depositAmount);
            await marginMarketContract.increasePosition(parseEther("1"), parseEther("0.5"));
    
            const positionBefore = await marginMarketContract.account_to_position(addr0.address);
            
            await ethers.provider.send('evm_mine');
            await marginMarketContract.testAccrueInterest();

            expect((await marginMarketContract.getPosition(addr0.address)).borrowedAmount).to.equal(
                parseEther(
                    (bigNumToDecimal(positionBefore.borrowedAmount) * (
                        bigNumToDecimal(await marginMarketContract.interestIndex()) / bigNumToDecimal(positionBefore.lastInterestIndex)
                    )).toString()
                )
            );
    
            await marginMarketContract.decreasePosition(parseEther("0.01"));
            
            const positionAfter = await marginMarketContract.account_to_position(addr0.address);
            expect(positionAfter.maintenanceMargin).to.equal(positionBefore.maintenanceMargin);
            expect(positionAfter.collateralAmount).to.equal(positionBefore.collateralAmount.sub(parseEther("0.01")));
            
            expect(await token0.balanceOf(marginMarketContract.address)).to.equal(
                (await marginMarketContract.totalReserved())
                    .add(positionAfter.maintenanceMargin)
            );
        });
    
        it("Should close position", async function() {
            const depositAmount = parseEther("1"); // Asset token
            await marginMarketContract.deposit(depositAmount);
            await marginMarketContract.increasePosition(parseEther("1"), parseEther("0.5"));
    
            const accountBalanceBefore = await token0.balanceOf(addr0.address);
            const positionBefore = await marginMarketContract.account_to_position(addr0.address);
            const marginMarketBalanceBefore = await token0.balanceOf(marginMarketContract.address);
            const boughtAssetTokens = await swapMarketContract.getInputToOutputAmount(token1.address, positionBefore.collateralAmount);
            const interestRate = calculateInterestRate(
                bigNumToDecimal(await marginMarketContract.totalBorrowed()) / 
                bigNumToDecimal((await marginMarketContract.totalReserved()).add(await marginMarketContract.totalBorrowed())),
                1
            );
    
            await ethers.provider.send('evm_mine');
            await marginMarketContract.decreasePosition(positionBefore.collateralAmount);
    
            const positionAfter = await marginMarketContract.account_to_position(addr0.address);
            expect(positionAfter.maintenanceMargin).to.equal(0);
            expect(positionAfter.collateralAmount).to.equal(0);
            expect(positionAfter.borrowedAmount).to.equal(0);
            expect(positionAfter.lastInterestIndex).to.equal(0);
            expect(await marginMarketContract.totalBorrowed()).to.equal(0);
    
            expect(await token0.balanceOf(marginMarketContract.address)).to.equal(
                marginMarketBalanceBefore
                    .sub(positionBefore.maintenanceMargin)
                    .add(positionBefore.borrowedAmount)
                    .add(parseEther((bigNumToDecimal(positionBefore.borrowedAmount) * interestRate).toString()))
                    .add(parseEther((bigNumToDecimal(positionBefore.borrowedAmount) * interestRate).toString()))
            );
    
            expect(await token0.balanceOf(addr0.address)).to.equal(
                accountBalanceBefore
                    .add(boughtAssetTokens.sub(positionBefore.borrowedAmount))
                    .add(positionBefore.maintenanceMargin)
                    .sub(parseEther((bigNumToDecimal(positionBefore.borrowedAmount) * interestRate).toString()))
                    .sub(parseEther((bigNumToDecimal(positionBefore.borrowedAmount) * interestRate).toString()))
            );
        });
    
        it("Should liquidate position with loss", async function() {
            const depositAmount = parseEther("1"); // Asset token
            await marginMarketContract.deposit(depositAmount);
            await marginMarketContract.increasePosition(parseEther("1"), parseEther("0.5"));

            const position = await marginMarketContract.account_to_position(addr0.address);

            await expect(marginMarketContract.liquidatePosition(addr0.address)).to.be.revertedWith("Position has sufficient collateral");
            await swapMarketContract.swap(token1.address, parseEther("10"), addr0.address, 0, 0, 0, ethers.constants.AddressZero);
            
            const liquidationAmount = await swapMarketContract.getInputToOutputAmount(token1.address, position.collateralAmount);

            await marginMarketContract.liquidatePosition(addr0.address);
            expect(await marginMarketContract.totalBorrowed()).to.equal(0);
            expect(await marginMarketContract.totalReserved()).to.equal(
                liquidationAmount
                    .add(position.maintenanceMargin)
                    .add(parseEther("0.5"))
            );

            expect(await token0.balanceOf(marginMarketContract.address)).to.equal(await marginMarketContract.totalReserved());
        });

        it("Should liquidate position without loss", async function() {
            const depositAmount = parseEther("1"); // Asset token
            await marginMarketContract.deposit(depositAmount);
            await marginMarketContract.increasePosition(parseEther("1"), parseEther("0.5"));

            const position = await marginMarketContract.account_to_position(addr0.address);
            
            await swapMarketContract.getInputToOutputAmount(token1.address, position.collateralAmount);
            await swapMarketContract.swap(token1.address, parseEther("0.16"), addr0.address, 0, 0, 0, ethers.constants.AddressZero);
            const liquidationAmount = await swapMarketContract.getInputToOutputAmount(token1.address, position.collateralAmount);

            await marginMarketContract.testAccrueInterest();
            const positionAfter = await marginMarketContract.getPosition(addr0.address);
            const interestRate = await marginMarketContract.interestRate();
            const borrowedAmount = positionAfter.borrowedAmount.add(positionAfter.borrowedAmount.mul(interestRate).div(ONE))

            const reservesBefore = await marginMarketContract.totalReserved();

            expect(liquidationAmount).to.be.lt(borrowedAmount);
            expect(liquidationAmount.add(position.maintenanceMargin)).to.be.gt(borrowedAmount);

            const ifexBalanceBefore = await ifexTokenContract.balanceOf(ifexTokenContract.address);

            await marginMarketContract.connect(addr1).liquidatePosition(addr0.address);

            expect(await marginMarketContract.totalReserved()).to.equal(
                reservesBefore
                    .add(
                        borrowedAmount
                            .add(
                                positionAfter.maintenanceMargin.sub(
                                    borrowedAmount.sub(liquidationAmount)
                                ).mul("50").div("100")
                            )
                    )
            );

            expect(await marginMarketContract.totalBorrowed()).to.equal(0);
            expect(await token0.balanceOf(marginMarketContract.address)).to.equal((await marginMarketContract.totalReserved()).add("1"));
            expect(await token0.balanceOf(addr1.address)).to.equal(
                positionAfter.maintenanceMargin.sub(
                    borrowedAmount.sub(liquidationAmount)
                ).mul("3").div("100")
            );
            expect(await ifexTokenContract.balanceOf(ifexTokenContract.address)).to.be.gt(ifexBalanceBefore);
        });
    });

    describe("Voting", function() {
        it("Should deposit votes", async function() {
            const depositedVoteWeight = parseEther("1");
            await marginMarketContract.depositVote(1, 2, depositedVoteWeight);

            await expect(marginMarketContract.depositVote(1, 2, depositedVoteWeight)).to.be.revertedWith("User has already voted on this proposal");
            await expect(marginMarketContract.depositVote(1, 3, depositedVoteWeight)).to.be.revertedWith("User has already voted on this proposal");

            expect(await ifexTokenContract.balanceOf(marginMarketContract.address)).to.equal(depositedVoteWeight);
            expect(await marginMarketContract.userDeposits(addr0.address)).to.equal(depositedVoteWeight);
            expect(await marginMarketContract.proposalVotes(1, 2)).to.equal(depositedVoteWeight.mul("150").div("100"));
            expect(await marginMarketContract.userVotes(addr0.address, 1, 2)).to.equal(depositedVoteWeight);
        });

        it("Should withdraw votes", async function() {
            const depositedVoteWeight = parseEther("1");
            
            await marginMarketContract.depositVote(1, 2, depositedVoteWeight);
            await expect(marginMarketContract.withdrawVote(1, 2)).to.be.revertedWith("User is currently voting in an active proposal");

            await marginMarketContract.connect(addr1).depositVote(1, 2, depositedVoteWeight);
            await marginMarketContract.connect(addr2).depositVote(1, 3, depositedVoteWeight);

            await ethers.provider.send("evm_increaseTime", [DAY * 5]);
            await ethers.provider.send("evm_mine");

            await marginMarketContract.finalizeVote(1);
            await marginMarketContract.withdrawVote(1, 2);

            expect(await ifexTokenContract.balanceOf(marginMarketContract.address)).to.equal(depositedVoteWeight.mul("2"));
            expect(await marginMarketContract.userVotes(addr0.address, 1, 2)).to.equal(0);
            expect(await marginMarketContract.userVotes(addr0.address, 1, 3)).to.equal(0);
            expect(await marginMarketContract.userDeposits(addr0.address)).to.equal(0);
        });

        it("Should get winning vote option", async function() {
            const depositedVoteWeight = parseEther("1");
            await marginMarketContract.depositVote(1, 2, depositedVoteWeight);

            expect((await marginMarketContract.getWinningOption(1))[0]).to.equal(2);
            expect((await marginMarketContract.getWinningOption(1))[1]).to.equal(depositedVoteWeight.mul("150").div("100"));

            await marginMarketContract.connect(addr1).depositVote(1, 1, depositedVoteWeight.mul("2"));
            expect((await marginMarketContract.getWinningOption(1))[0]).to.equal(1);
            expect((await marginMarketContract.getWinningOption(1))[1]).to.equal(depositedVoteWeight.mul("2"));
        });

        it("Should finalize min initial margin vote", async function() {
            const depositedVoteWeight = parseEther("1");
            
            await marginMarketContract.depositVote(1, 3, depositedVoteWeight);
            await expect(marginMarketContract.finalizeVote(1)).to.be.revertedWith("Proposal still has time left");

            const minInitialMarginBefore = await marginMarketContract.minInitialMarginRate();
            const [winningOption] = await marginMarketContract.getWinningOption(1);

            expect(winningOption).to.be.equal(3);

            await ethers.provider.send("evm_increaseTime", [DAY * 0.95]);
            await ethers.provider.send("evm_mine");

            await expect(marginMarketContract.finalizeVote(1)).to.be.revertedWith("Proposal still has time left");

            await ethers.provider.send("evm_increaseTime", [DAY * 0.95]);
            await ethers.provider.send("evm_mine");

            await marginMarketContract.finalizeVote(1);

            expect(await marginMarketContract.minInitialMarginRate()).to.be.equal(minInitialMarginBefore.add(minInitialMarginBefore.mul("10").div("100")));

            await marginMarketContract.depositVote(1, 1, depositedVoteWeight); 

            await ethers.provider.send("evm_increaseTime", [DAY * 1]);
            await ethers.provider.send("evm_mine");

            const minInitialMarginBefore1 = await marginMarketContract.minInitialMarginRate();
            await marginMarketContract.finalizeVote(1);

            expect(await marginMarketContract.minInitialMarginRate()).to.be.equal(minInitialMarginBefore1.sub(minInitialMarginBefore1.mul("10").div("100")));
        });
        
        it("Should finalize max borrow amount vote", async function() {
            const depositedVoteWeight = parseEther("1");
            
            const maxBorrowAmountBefore = await marginMarketContract.maxBorrowAmount();

            await marginMarketContract.depositVote(4, 3, depositedVoteWeight);
            await expect(marginMarketContract.finalizeVote(4)).to.be.revertedWith("Proposal still has time left");

            await ethers.provider.send("evm_increaseTime", [DAY * 1]);
            await ethers.provider.send("evm_mine");

            await marginMarketContract.finalizeVote(4);

            expect(await marginMarketContract.maxBorrowAmount()).to.equal(maxBorrowAmountBefore.add(maxBorrowAmountBefore.mul("15").div("100")));
        });

        it("Should finalize interest multiplier vote", async function() {
            const depositedVoteWeight = parseEther("1");
            
            await marginMarketContract.depositVote(3, 3, depositedVoteWeight);
            await expect(marginMarketContract.finalizeVote(3)).to.be.revertedWith("Proposal still has time left");

            const interestMultiplierBefore = await marginMarketContract.interestMultiplier();
            const [winningOption] = await marginMarketContract.getWinningOption(3);

            expect(winningOption).to.be.equal(3);

            await ethers.provider.send("evm_increaseTime", [DAY * 0.9]);
            await ethers.provider.send("evm_mine");

            await expect(marginMarketContract.finalizeVote(3)).to.be.revertedWith("Proposal still has time left");

            await ethers.provider.send("evm_increaseTime", [DAY * 0.15]);
            await ethers.provider.send("evm_mine");

            await marginMarketContract.finalizeVote(3);

            expect(await marginMarketContract.interestMultiplier()).to.be.equal(interestMultiplierBefore.add(interestMultiplierBefore.mul("5").div("100")));

            await marginMarketContract.depositVote(3, 1, depositedVoteWeight); 

            await ethers.provider.send("evm_increaseTime", [DAY * 0.9]);
            await ethers.provider.send("evm_mine");

            await expect(marginMarketContract.finalizeVote(3)).to.be.revertedWith("Proposal still has time left");

            await ethers.provider.send("evm_increaseTime", [DAY * 3]);
            await ethers.provider.send("evm_mine");

            const interestMultiplierBefore1 = await marginMarketContract.interestMultiplier();
            await marginMarketContract.finalizeVote(3);

            expect(await marginMarketContract.interestMultiplier()).to.be.equal(interestMultiplierBefore1.sub(interestMultiplierBefore1.mul("5").div("100")));
            expect(await marginMarketContract.proposalVotes(3, 1)).to.be.equal(0);
            expect(await marginMarketContract.proposalVotes(3, 3)).to.be.equal(0);
            expect(await marginMarketContract.proposalVotes(3, 2)).to.be.equal(0);
        });
    });

    describe("Integration", function() {

    });

    describe("Invalid inputs", function() {

    });
});