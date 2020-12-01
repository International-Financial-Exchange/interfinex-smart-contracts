const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

describe("Factory contract", function() {
    let marginFactoryContract, templateMarginMarketContract, templateDividendERC20Contract, ifexTokenContract;
    let token0, token1, token3, token4;
    let owner, addr1, addr2, addrs;
  
    beforeEach(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        ERC20 = await ethers.getContractFactory("ERC20");
        [token0, token1, token3, token4] = await Promise.all(
            new Array(4).fill().map(async (_, i) => {
                const tokenContract = await ERC20.deploy();
                await tokenContract.initializeERC20(`token${i}`, `${i}`, 18, ethers.utils.parseEther("210"), true);
                return tokenContract;
            })
        );

        DividendERC20 = await ethers.getContractFactory("DividendERC20");
        templateDividendERC20Contract = await DividendERC20.deploy();

        ifexTokenContract = await DividendERC20.deploy();
        await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, parseEther("2100000000"), ifexTokenContract.address, false);

        SwapExchange = await ethers.getContractFactory("SwapExchange");
        templateSwapExchangeContract = await SwapExchange.deploy();

        SwapFactory = await ethers.getContractFactory("SwapFactory");
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

        MarginMarket = await ethers.getContractFactory("MarginMarket");
        templateMarginMarketContract = await MarginMarket.deploy();

        MarginFactory = await ethers.getContractFactory("MarginFactory");
        marginFactoryContract = await MarginFactory.deploy();

        await marginFactoryContract.initialize(
            templateMarginMarketContract.address, 
            templateDividendERC20Contract.address, 
            ifexTokenContract.address,
            swapFactoryContract.address
        );
    });

    it("Should initialize factory", async function() {
        expect(await marginFactoryContract.is_initialized()).to.equal(true);
        expect(await marginFactoryContract.margin_market_template()).to.equal(templateMarginMarketContract.address);
        expect(await marginFactoryContract.margin_market_template()).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should create margin market", async function() {
        await marginFactoryContract.createMarketPair(token0.address, token1.address);

        expect(await marginFactoryContract.id_count()).to.equal(2);
        
        const firstMarginMarketAddress = await marginFactoryContract.id_to_margin_market(1);
        expect(firstMarginMarketAddress).to.not.equal(ethers.constants.AddressZero);
        
        expect(await marginFactoryContract.pair_to_margin_market(token0.address, token1.address)).to.not.equal(ethers.constants.AddressZero);
        expect(await marginFactoryContract.pair_to_margin_market(token0.address, token1.address)).to.equal(firstMarginMarketAddress);
        
        expect(await marginFactoryContract.margin_market_to_pair(firstMarginMarketAddress, 0)).to.equal(token0.address);
        expect(await marginFactoryContract.margin_market_to_pair(firstMarginMarketAddress, 1)).to.equal(token1.address);
    });

    it("Should not create margin market", async function() {
        await marginFactoryContract.createMarketPair(token0.address, token1.address);

        await expect(marginFactoryContract.createMarketPair(token0.address, token1.address)).to.be.revertedWith("Margin market for this pair already exists");
        await expect(marginFactoryContract.createMarketPair(token1.address, token0.address)).to.be.revertedWith("Margin market for this pair already exists");
    });
});