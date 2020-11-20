const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

const ONE = ethers.utils.parseEther("1");

const calculateInterestRate = (utilizationRate, multiplier) => Math.pow(utilizationRate * multiplier, 2);
const bigNumToDecimal = bigNum => parseFloat(ethers.utils.formatUnits(bigNum.toString(), 18));;
const DAY = 60 * 60 * 24;

const INITIAL_MARGIN_PROPOSAL = 1;
const MAINTENANCE_MARGIN_PROPOSAL = 2;
const INTEREST_MULTIPLIER_PROPOSAL = 3;
const MAX_BORROW_AMOUNT_PROPOSAL = 4;

const DOWN_OPTION = 1;
const PRESERVE_OPTION = 2;
const UP_OPTION = 3;

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
                await tokenContract.initializeERC20(`token${i}`, `${i}`, 18, 2100000000, true);
                return tokenContract;
            })
        );

        DividendERC20 = await ethers.getContractFactory("DividendERC20");
        templateDividendERC20Contract = await DividendERC20.deploy();

        ifexTokenContract = await DividendERC20.deploy();
        await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, 2100000000, ifexTokenContract.address, false);

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

        await token0.transfer(addr1.address, parseEther("100"));
        await token1.transfer(addr1.address, parseEther("100"));
        await token0.transfer(addr2.address, parseEther("100"));
        await token1.transfer(addr2.address, parseEther("100"));
        await token0.transfer(addr3.address, parseEther("100"));
        await token1.transfer(addr3.address, parseEther("100"));

        await token0.connect(addr1).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await token1.connect(addr1).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await token0.connect(addr2).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await token1.connect(addr2).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await token0.connect(addr3).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await token1.connect(addr3).approve(marginMarketContract.address, ethers.constants.MaxUint256);

        await marginMarketContract.initialize(token0.address, token1.address, templateDividendERC20Contract.address, ifexTokenContract.address, swapFactoryContract.address);
        liquidityTokenContract = await ethers.getContractAt("DividendERC20", await marginMarketContract.liquidityToken());
        liquidityTokenContract.approve(marginMarketContract.address, ethers.constants.MaxUint256);

        await liquidityTokenContract.connect(addr1).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await liquidityTokenContract.connect(addr2).approve(marginMarketContract.address, ethers.constants.MaxUint256);
        await liquidityTokenContract.connect(addr3).approve(marginMarketContract.address, ethers.constants.MaxUint256);
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
            expect(position.maintenanceMargin).to.equal(parseEther((0.5 * 0.15).toString()));
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
                    .add(1)
            );
    
            expect(await token0.balanceOf(addr0.address)).to.equal(
                accountBalanceBefore
                    .add(boughtAssetTokens.sub(positionBefore.borrowedAmount))
                    .add(positionBefore.maintenanceMargin)
                    .sub(parseEther((bigNumToDecimal(positionBefore.borrowedAmount) * interestRate).toString()).add(1))
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
            await swapMarketContract.swap(token1.address, parseEther("0.17"), addr0.address, 0, 0, 0, ethers.constants.AddressZero);
            const liquidationAmount = await swapMarketContract.getInputToOutputAmount(token1.address, position.collateralAmount);

            await ethers.provider.send("evm_mine");
            const positionAfter = await marginMarketContract.getPosition(addr0.address);
            const interestRate = await marginMarketContract.interestRate();
            const borrowedAmount = positionAfter.borrowedAmount;

            const reservesBefore = await marginMarketContract.totalReserved();

            expect(positionAfter.borrowedAmount).to.be.equal(
                position.borrowedAmount
                    .add(position.borrowedAmount.mul(interestRate).div(ONE))
                    .add(position.borrowedAmount.mul(interestRate).div(ONE))
            );

            const newBorrowAmount = position.borrowedAmount
                .add(position.borrowedAmount.mul(interestRate).div(ONE))
                .add(position.borrowedAmount.mul(interestRate).div(ONE))
                .add(position.borrowedAmount.mul(interestRate).div(ONE));
            
            expect(liquidationAmount).to.be.lt(newBorrowAmount);
            expect(liquidationAmount.add(position.maintenanceMargin)).to.be.gt(newBorrowAmount);

            const ifexBalanceBefore = await ifexTokenContract.balanceOf(ifexTokenContract.address);

            const addr1BalanceBefore = await token0.balanceOf(addr1.address);
            await marginMarketContract.connect(addr1).liquidatePosition(addr0.address);

            expect(await marginMarketContract.totalReserved()).to.equal(
                reservesBefore
                    .add(
                        newBorrowAmount
                            .add(
                                positionAfter.maintenanceMargin.sub(
                                    newBorrowAmount.sub(liquidationAmount)
                                ).mul("50").div("100")
                            )
                    )
                    .add(1)
            );

            expect(await marginMarketContract.totalBorrowed()).to.equal(0);
            expect(await token0.balanceOf(marginMarketContract.address)).to.equal((await marginMarketContract.totalReserved()).add("1"));
            expect(await token0.balanceOf(addr1.address)).to.equal(
                addr1BalanceBefore.add(
                    positionAfter.maintenanceMargin.sub(
                        newBorrowAmount.sub(liquidationAmount)
                    ).mul("3").div("100")
                )
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
        it("Should trade correctly", async function() {
            // Deposit from 3 accounts
            let addr0Deposit = parseEther("1");
            await marginMarketContract.connect(addr0).deposit(addr0Deposit);
            let addr1Deposit = parseEther("0.5");
            await marginMarketContract.connect(addr1).deposit(addr1Deposit);
            let addr2Deposit = parseEther("1.5");
            await marginMarketContract.connect(addr2).deposit(addr2Deposit);

            expect(await token0.balanceOf(marginMarketContract.address)).to.be.equal(addr0Deposit.add(addr1Deposit).add(addr2Deposit));
            expect(
                (await liquidityTokenContract.balanceOf(addr0.address))
                    .mul(ONE)
                    .div(await liquidityTokenContract.totalSupply())
            ).to.be.equal(
                addr0Deposit
                    .mul(ONE)
                    .div(addr0Deposit.add(addr1Deposit).add(addr2Deposit))
            );

            expect(
                (await liquidityTokenContract.balanceOf(addr1.address))
                    .mul(ONE)
                    .div(await liquidityTokenContract.totalSupply())
            ).to.be.equal(
                addr1Deposit
                    .mul(ONE)
                    .div(addr0Deposit.add(addr1Deposit).add(addr2Deposit))
            );

            expect(
                (await liquidityTokenContract.balanceOf(addr2.address))
                    .mul(ONE)
                    .div(await liquidityTokenContract.totalSupply())
            ).to.be.equal(
                addr2Deposit
                    .mul(ONE)
                    .div(addr0Deposit.add(addr1Deposit).add(addr2Deposit))
            );

            expect(await marginMarketContract.totalReserved()).to.be.equal(addr0Deposit.add(addr1Deposit).add(addr2Deposit));

            // Withdraw partially from 2 accounts
            let addr1BalanceBefore = await token0.balanceOf(addr1.address);
            await marginMarketContract.connect(addr1).withdraw((await liquidityTokenContract.balanceOf(addr1.address)).div(2));
            expect(await token0.balanceOf(addr1.address)).to.be.equal(addr1BalanceBefore.add(addr1Deposit.div("2")));
            expect(await marginMarketContract.totalReserved()).to.be.equal(await token0.balanceOf(marginMarketContract.address));
            addr1Deposit = addr1Deposit.div("2");

            let addr2BalanceBefore = await token0.balanceOf(addr2.address);
            await marginMarketContract.connect(addr2).withdraw((await liquidityTokenContract.balanceOf(addr2.address)).div(2));
            expect(await token0.balanceOf(addr2.address)).to.be.equal(addr2BalanceBefore.add(addr2Deposit.div("2")));
            expect(await marginMarketContract.totalReserved()).to.be.equal(await token0.balanceOf(marginMarketContract.address));
            addr2Deposit = addr2Deposit.div("2");
            
            // Enter position from 2 accounts
            let [initialAddr3Margin, initialAddr3BorrowAmount] = [parseEther("0.05"), parseEther("0.1")];
            await expect(marginMarketContract.connect(addr3).increasePosition(initialAddr3Margin, initialAddr3BorrowAmount)).to.be.revertedWith("Insufficient initial margin");
            
            initialAddr3Margin = initialAddr3BorrowAmount
                .mul("50")
                .div("100")
                .add(
                    initialAddr3BorrowAmount
                        .mul("14")
                        .div("100")    
                );

            await expect(marginMarketContract.connect(addr3).increasePosition(initialAddr3Margin, initialAddr3BorrowAmount)).to.be.revertedWith("Insufficient initial margin");
            
            initialAddr3Margin = initialAddr3BorrowAmount
                .mul("50")
                .div("100")
                .add(
                    initialAddr3BorrowAmount
                        .mul("16")
                        .div("100")    
                );

            let totalReservedBefore = await marginMarketContract.totalReserved();
            let addr3CollateralBought = await swapMarketContract.getInputToOutputAmount(
                token0.address, 
                initialAddr3BorrowAmount.add(initialAddr3Margin.sub(initialAddr3BorrowAmount.mul("15").div("100"))),
            );
            await marginMarketContract.connect(addr3).increasePosition(initialAddr3Margin, initialAddr3BorrowAmount);

            
            const addr3Position = await marginMarketContract.getPosition(addr3.address);
            expect(addr3Position.maintenanceMargin).to.be.equal(
                initialAddr3BorrowAmount
                    .mul("15")
                    .div("100")
            );

            expect(await marginMarketContract.interestRate()).to.be.equal(
                initialAddr3BorrowAmount
                    .mul(ONE)
                    .div((await marginMarketContract.totalReserved()).add(await marginMarketContract.totalBorrowed()))
                    .mul(await marginMarketContract.interestMultiplier())
                    .div(ONE)
                    .pow("2")
                    .div(ONE)
            );

            expect(addr3Position.borrowedAmount).to.be.equal(initialAddr3BorrowAmount);
            expect(addr3Position.collateralAmount).to.be.equal(addr3CollateralBought);

            let [initialAddr2Margin, initialAddr2BorrowAmount] = [parseEther("0.05"), parseEther("0.1")];
            initialAddr2Margin = initialAddr2BorrowAmount
                .mul("50")
                .div("100")
                .add(
                    initialAddr3BorrowAmount
                        .mul("16")
                        .div("100")    
                );

            let interestRate = await marginMarketContract.interestRate();
            await marginMarketContract.connect(addr2).increasePosition(initialAddr2Margin, initialAddr2BorrowAmount);

            expect(await marginMarketContract.totalReserved()).to.be.equal(
                totalReservedBefore.sub(
                    initialAddr2BorrowAmount.add(initialAddr3BorrowAmount)
                )
            );
            expect(await marginMarketContract.totalBorrowed()).to.be.equal(
                initialAddr2BorrowAmount
                    .add(
                        initialAddr3BorrowAmount
                            .add(initialAddr3BorrowAmount.mul(interestRate).div(ONE))
                    )
            );

            expect(await marginMarketContract.interestRate()).to.be.equal(
                initialAddr2BorrowAmount
                    .add(
                        initialAddr3BorrowAmount
                            .add(initialAddr3BorrowAmount.mul(interestRate).div(ONE))
                    )
                    .mul(ONE)
                    .div((await marginMarketContract.totalReserved()).add(await marginMarketContract.totalBorrowed()))
                    .mul(await marginMarketContract.interestMultiplier())
                    .div(ONE)
                    .pow("2")
                    .div(ONE)
            );

            // Reduce position from 1 account without a complete exit
            let position3Before = await marginMarketContract.getPosition(addr3.address);
            let collateralAmount = position3Before.collateralAmount.div("50");
            let assetAmountBought = await swapMarketContract.getInputToOutputAmount(token1.address, collateralAmount);
            let interestRateBefore = await marginMarketContract.interestRate();
            totalReservedBefore = await marginMarketContract.totalReserved();
            await marginMarketContract.connect(addr3).decreasePosition(collateralAmount);
            
            let position3After = await marginMarketContract.getPosition(addr3.address);
            expect(position3After.collateralAmount).to.be.equal(position3Before.collateralAmount.sub(collateralAmount));
            expect(position3After.borrowedAmount).to.be.equal(
                position3Before.borrowedAmount
                    .add(position3Before.borrowedAmount.mul(interestRateBefore).div(ONE))
                    .sub(assetAmountBought)
                    .add(1)
            );
            expect(await marginMarketContract.totalReserved()).to.be.equal(totalReservedBefore.add(assetAmountBought));

            // Close position from 1 account
            position3Before = await marginMarketContract.getPosition(addr3.address);
            addr3BalanceBefore = await token0.balanceOf(addr3.address);
            assetAmountBought = await swapMarketContract.getInputToOutputAmount(token1.address, position3Before.collateralAmount);
            totalReservedBefore = await marginMarketContract.totalReserved();
            interestRateBefore = await marginMarketContract.interestRate();

            await marginMarketContract.connect(addr3).closePosition(); 

            position3After = await marginMarketContract.getPosition(addr3.address);

            expect(position3After.collateralAmount).to.be.equal(0);
            expect(position3After.maintenanceMargin).to.be.equal(0);
            expect(position3After.borrowedAmount).to.be.equal(0);
            expect(await marginMarketContract.totalReserved()).to.be.equal(
                totalReservedBefore.add(
                    position3Before.borrowedAmount.add(position3Before.borrowedAmount.mul(interestRateBefore).div(ONE).add(1))
                )
            );
            expect(await token0.balanceOf(marginMarketContract.address)).to.be.equal(
                (await marginMarketContract.totalReserved())
                    .add((await marginMarketContract.getPosition(addr2.address)).maintenanceMargin)
            );
            expect(await token0.balanceOf(addr3.address)).to.be.equal(
                addr3BalanceBefore
                    .add(
                        assetAmountBought.sub(
                            position3Before.borrowedAmount
                                .add(position3Before.borrowedAmount.mul(interestRateBefore).div(ONE).add(1)) 
                        )
                    )
                    .add(
                        position3Before.maintenanceMargin
                    )
            );
            
            // Withdraw from all accounts
            let liquidityBalanceBefore = await liquidityTokenContract.balanceOf(addr0.address);
            let liquidityTotalSupplyBefore = await liquidityTokenContract.totalSupply();
            let assetBalanceBefore = await token0.balanceOf(addr0.address);
            interestRateBefore = await marginMarketContract.interestRate();
            totalReservedBefore = await marginMarketContract.totalReserved();
            let totalBorrowedBefore = await marginMarketContract.totalBorrowed();

            let liquidityWithdrawAmount = liquidityBalanceBefore.div("2");

            await marginMarketContract.connect(addr0).withdraw(liquidityWithdrawAmount);

            expect(await marginMarketContract.totalReserved()).to.be.equal(
                totalReservedBefore
                    .sub(
                        totalReservedBefore
                            .add(totalBorrowedBefore.add(
                                totalBorrowedBefore.mul(interestRateBefore).div(ONE)
                            ))
                            .mul(liquidityWithdrawAmount)
                            .div(liquidityTotalSupplyBefore)
                    )
            );
            expect(await token0.balanceOf(addr0.address)).to.be.equal(
                assetBalanceBefore.add(
                    totalReservedBefore
                        .add(totalBorrowedBefore.add(
                            totalBorrowedBefore.mul(interestRateBefore).div(ONE)
                        ))
                        .mul(liquidityWithdrawAmount)
                        .div(liquidityTotalSupplyBefore)
                )
            );

            await marginMarketContract.connect(addr2).closePosition();

            await marginMarketContract.connect(addr0).withdraw(liquidityWithdrawAmount);
            await marginMarketContract.connect(addr1).withdraw(await liquidityTokenContract.balanceOf(addr1.address));

            await marginMarketContract.connect(addr2).withdraw((await liquidityTokenContract.balanceOf(addr2.address)));

            expect(await token0.balanceOf(marginMarketContract.address)).to.be.equal(0);
            expect(await marginMarketContract.totalReserved()).to.be.equal(0);
            expect(await marginMarketContract.totalBorrowed()).to.be.equal(0);
            expect(await marginMarketContract.interestRate()).to.be.equal(0);
        });

        it("Should vote correctly", async function() {
            // Deposit vote from 3 accounts
            let addr1Vote = parseEther("20");
            await marginMarketContract.connect(addr1).depositVote(INITIAL_MARGIN_PROPOSAL, UP_OPTION, addr1Vote);
            let addr2Vote = parseEther("10");
            await marginMarketContract.connect(addr2).depositVote(INITIAL_MARGIN_PROPOSAL, PRESERVE_OPTION, addr2Vote);
            let addr3Vote = parseEther("40");
            await marginMarketContract.connect(addr3).depositVote(INITIAL_MARGIN_PROPOSAL, PRESERVE_OPTION, addr3Vote);

            expect(await marginMarketContract.proposalVotes(INITIAL_MARGIN_PROPOSAL, PRESERVE_OPTION)).to.be.equal(
                addr2Vote.add(addr3Vote).mul("150").div("100")
            );

            expect(await marginMarketContract.proposalVotes(INITIAL_MARGIN_PROPOSAL, UP_OPTION)).to.be.equal(addr1Vote);
            expect(await marginMarketContract.proposalVotes(INITIAL_MARGIN_PROPOSAL, DOWN_OPTION)).to.be.equal(0);
            expect((await marginMarketContract.getWinningOption(INITIAL_MARGIN_PROPOSAL))[0]).to.be.equal(PRESERVE_OPTION);

            // Fail withdraw vote from 1 account
            await expect(marginMarketContract.connect(addr1).withdrawVote(INITIAL_MARGIN_PROPOSAL, DOWN_OPTION)).to.be.revertedWith("User is currently voting in an active proposal");

            // Fail deposit vote
            await expect(marginMarketContract.connect(addr2).depositVote(INITIAL_MARGIN_PROPOSAL, DOWN_OPTION, parseEther("1"))).to.be.revertedWith("User has already voted on this proposal");
            
            // Succeed deposit vote into different proposal
            let addr1MaintenanceVote = parseEther("1");
            await marginMarketContract.connect(addr1).depositVote(MAINTENANCE_MARGIN_PROPOSAL, UP_OPTION, addr1MaintenanceVote);
            expect((await marginMarketContract.getWinningOption(MAINTENANCE_MARGIN_PROPOSAL))[0]).to.be.equal(UP_OPTION);

            // Fail finalize vote
            await expect(marginMarketContract.finalizeVote(INITIAL_MARGIN_PROPOSAL)).to.be.revertedWith("Proposal still has time left");
            
            // Finalize vote
            await ethers.provider.send("evm_increaseTime", [DAY]);
            await ethers.provider.send("evm_mine");

            let initialMarginBefore = await marginMarketContract.minInitialMarginRate();
            await marginMarketContract.finalizeVote(INITIAL_MARGIN_PROPOSAL);
            expect(await marginMarketContract.proposalVotes(INITIAL_MARGIN_PROPOSAL, UP_OPTION)).to.be.equal(0);
            expect(await marginMarketContract.proposalVotes(INITIAL_MARGIN_PROPOSAL, DOWN_OPTION)).to.be.equal(0);
            expect(await marginMarketContract.proposalVotes(INITIAL_MARGIN_PROPOSAL, PRESERVE_OPTION)).to.be.equal(0);

            // (Preserve option should have won)
            expect(await marginMarketContract.minInitialMarginRate()).to.be.equal(initialMarginBefore);

            // Deposit vote
            await marginMarketContract.connect(addr1).depositVote(INITIAL_MARGIN_PROPOSAL, DOWN_OPTION, addr1Vote);
            expect(await marginMarketContract.userDeposits(addr1.address)).to.be.equal(addr1Vote.add(addr1Vote).add(addr1MaintenanceVote));
            expect(await marginMarketContract.userVotes(addr1.address, INITIAL_MARGIN_PROPOSAL, UP_OPTION)).to.be.equal(addr1Vote);
            
            // Withdraw vote
            await ethers.provider.send("evm_increaseTime", [DAY]);
            await ethers.provider.send("evm_mine");
            await marginMarketContract.finalizeVote(INITIAL_MARGIN_PROPOSAL);

            let addr1BalanceBefore = await ifexTokenContract.balanceOf(addr1.address);
            await marginMarketContract.connect(addr1).withdrawVote(INITIAL_MARGIN_PROPOSAL, UP_OPTION);
            expect(await ifexTokenContract.balanceOf(addr1.address)).to.be.equal(addr1BalanceBefore.add(addr1Vote));
            await marginMarketContract.connect(addr1).withdrawVote(INITIAL_MARGIN_PROPOSAL, DOWN_OPTION);
            expect(await ifexTokenContract.balanceOf(addr1.address)).to.be.equal(addr1BalanceBefore.add(addr1Vote).add(addr1Vote));

            // Withdraw and finalize all votes
            await marginMarketContract.connect(addr2).withdrawVote(INITIAL_MARGIN_PROPOSAL, PRESERVE_OPTION);
            await marginMarketContract.connect(addr3).withdrawVote(INITIAL_MARGIN_PROPOSAL, PRESERVE_OPTION);

            await expect(marginMarketContract.connect(addr1).withdrawVote(MAINTENANCE_MARGIN_PROPOSAL, UP_OPTION)).to.be.revertedWith("User is currently voting in an active proposal");
            
            await ethers.provider.send("evm_increaseTime", [DAY]);
            await ethers.provider.send("evm_mine");
            let maintenanceMarginBefore = await marginMarketContract.maintenanceMarginRate();
            await marginMarketContract.finalizeVote(MAINTENANCE_MARGIN_PROPOSAL);

            expect(await marginMarketContract.maintenanceMarginRate()).to.be.equal(maintenanceMarginBefore.add(maintenanceMarginBefore.mul("5").div("100")))

            await marginMarketContract.connect(addr1).withdrawVote(MAINTENANCE_MARGIN_PROPOSAL, UP_OPTION);

            expect(await ifexTokenContract.balanceOf(marginMarketContract.address)).to.be.equal(0);
        });
    });

    describe("Security", function() {
        // it("Should reject zero inputs", async function() {

        // });

        // it("Should reject duplicate withdrawals", async function() {

        // });

        // it("Should liquidate with interest rate", async function() {

        // });

        // it("Should prevent re-entrancy", async function() {

        // });
    });
});