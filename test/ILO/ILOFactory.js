const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

describe("ILOFactory contract", function() {
    let iloFactoryContract, templateFixedPriceIloContract, templateSwapExchangeContract, wrappedEtherContract, swapFactoryContract, templateDividendERC20Contract, ifexTokenContract;
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

        const FixedPriceILO = await ethers.getContractFactory("FixedPriceILO");
        templateFixedPriceIloContract = await FixedPriceILO.deploy();

        const DutchAuctionILO = await ethers.getContractFactory("DutchAuctionILO");
        templateDutchAuctionILOContract = await DutchAuctionILO.deploy();

        const ILOFactory = await ethers.getContractFactory("ILOFactory");
        iloFactoryContract = await ILOFactory.deploy();

        await iloFactoryContract.initialize(
            templateDividendERC20Contract.address,
            ifexTokenContract.address,
            swapFactoryContract.address,
            templateFixedPriceIloContract.address,
            templateDutchAuctionILOContract.address,
            wrappedEtherContract.address,
        );
    });

    it("Should initialize contract", async function () {
        expect(await iloFactoryContract.dividend_erc20_template()).to.be.equal(templateDividendERC20Contract.address);
        expect(await iloFactoryContract.ifex_token()).to.be.equal(ifexTokenContract.address);
        expect(await iloFactoryContract.swap_factory()).to.be.equal(swapFactoryContract.address);
        expect(await iloFactoryContract.fixed_price_ILO_template()).to.be.equal(templateFixedPriceIloContract.address);
        expect(await iloFactoryContract.wrapped_ether()).to.be.equal(wrappedEtherContract.address);
        expect(await iloFactoryContract.owner()).to.be.equal(owner.address);
        expect(await iloFactoryContract.is_initialized()).to.be.equal(true);

        await expect(
            iloFactoryContract.initialize(
                templateDividendERC20Contract.address,
                ifexTokenContract.address,
                swapFactoryContract.address,
                templateFixedPriceIloContract.address,
                templateDutchAuctionILOContract.address,
                wrappedEtherContract.address,
            )
        ).to.be.revertedWith("Factory already initialized");
    });

    it("Should create FixedPriceILO contract", async function() {
        await token0.approve(iloFactoryContract.address, ethers.constants.MaxUint256);
        await iloFactoryContract.createFixedPriceILO(
            token0.address,
            parseEther("100"),
            parseEther("5"),
            0,
            0,
            0,
            parseEther("0.3"),
            0,           
        );

        expect(await iloFactoryContract.id_count()).to.be.equal(1);

        const fixedPricedILOContract = await iloFactoryContract.id_to_ILO(1);
        expect(fixedPricedILOContract).to.not.equal(ethers.constants.AddressZero);
        expect(await token0.balanceOf(fixedPricedILOContract)).to.be.equal(parseEther("100"));
    });

    it("Should create DutchAuctionILO contract", async function() {
        await token0.approve(iloFactoryContract.address, ethers.constants.MaxUint256);
        await iloFactoryContract.createDutchAuctionILO(
            token0.address,
            parseEther("100"),
            parseEther("5"),
            parseEther("10"),
            0,
            0,
            parseEther("0.3"),
            0,           
        );

        expect(await iloFactoryContract.id_count()).to.be.equal(1);

        const dutchAuctionIloContract = await iloFactoryContract.id_to_ILO(1);
        expect(dutchAuctionIloContract).to.not.equal(ethers.constants.AddressZero);
        expect(await token0.balanceOf(dutchAuctionIloContract)).to.be.equal(parseEther("100"));
    });
});