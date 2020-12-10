const { BigNumber } = require("ethers");
const { ethers, hardhatArguments } = require("hardhat");

const { parseEther } = ethers.utils;
const ONE = ethers.utils.parseEther("1");

let ERC20, DividendERC20, SwapExchange, SwapFactory, MarginMarket, MarginFactory, WrappedEther;
const RESET = true;

const initializeArtifacts = async () => {
    ERC20 = await ethers.getContractFactory("ERC20");
    DividendERC20 = await ethers.getContractFactory("DividendERC20");
    SwapExchange = await ethers.getContractFactory("SwapExchange");
    SwapFactory = await ethers.getContractFactory("SwapFactory");
    MarginMarket = await ethers.getContractFactory("MarginMarket");
    MarginFactory = await ethers.getContractFactory("MarginFactory");
    WrappedEther = await ethers.getContractFactory("WrappedEther");
};

const tokenContracts = async () =>  {
    console.log("");

    const tokens = [];
    for (i in new Array(4).fill()) {
        const tokenContract = await tracked.deploy("ERC20", `Token${i}`, RESET);
        await tokenContract.initializeERC20(`token${i}`, `${i}`, 18, 2100000000, true);
        tokens.push(tokenContract);
    }

    console.log(`🚜 Deployed ${tokens.length} testnet ERC20 token contracts`);

    const templateDividendERC20Contract = await tracked.deploy("DividendERC20", "TemplateDividendERC20", RESET);
    console.log(`🚜 Deployed template DividendERC20 contract`);

    const ifexTokenContract = await tracked.deploy("DividendERC20", "IfexToken", RESET);
    await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, 2100000000, ifexTokenContract.address, false);
    console.log(`🚜 Deployed testnet IFEX token contract`);

    return { tokens, templateDividendERC20Contract, ifexTokenContract };
};

const wrappedEtherContract = async () => {
    console.log("");

    const wrappedEtherContract = await tracked.deploy("WrappedEther", `WrappedEther`, RESET);
    await wrappedEtherContract.deposit({ value: parseEther("0.1") });

    console.log(`🚜 Deployed Wrapped Ether contract`);

    return { wrappedEtherContract };
};

const swapContracts = async () => {
    // console.log("");
    // const templateSwapExchangeContract = await tracked.deploy("SwapExchange", "TemplateSwapExchange", RESET);
    // console.log(`🚜 Deployed template SwapExchange contract: ${templateSwapExchangeContract.address}`);

    // const swapFactoryContract = await tracked.deploy("SwapFactory", "SwapFactory", RESET);

    const { 
        IfexToken, 
        TemplateDividendERC20, 
        TemplateSwapExchange,
        WrappedEther 
    } = tracked.contracts[hre.network.name];

    // await swapFactoryContract.initialize_factory(
    //     parseEther("0.001"), 
    //     TemplateSwapExchange.address, 
    //     TemplateDividendERC20.address,
    //     IfexToken.address
    // );
    // console.log(`🚜 Deployed and Initialized SwapFactory contract: ${swapFactoryContract.address}`);

    const {
        SwapFactory
    } = tracked.contracts[hre.network.name];

    const swapEthRouterContract = await tracked.deploy("SwapEthRouter", "SwapEthRouter", RESET);
    await swapEthRouterContract.initialize(
        WrappedEther.address, 
        SwapFactory.address, 
        IfexToken.address
    );
    console.log(`🚜 Deployed and Initialized SwapEthRouter contract: ${swapEthRouterContract.address}`);

    // return { swapFactoryContract, swapEthRouterContract };
};

const marginContracts = async () => {
    console.log("");
    const templateMarginMarketContract = await tracked.deploy("MarginMarket", "templateMarginMarket", RESET);
    console.log(`🚜 Deployed template MarginMarket contract: ${templateMarginMarketContract.address}`);
    
    const marginFactoryContract = await tracked.deploy("MarginFactory", "MarginFactory", RESET);

    const {
        TemplateDividendERC20,
        IfexToken,
        SwapFactory,
        WrappedEther,
    } = tracked.contracts[hre.network.name];

    await marginFactoryContract.initialize(
        templateMarginMarketContract.address, 
        TemplateDividendERC20.address, 
        IfexToken.address,
        SwapFactory.address
    );
    console.log(`🚜 Deployed and Initialized MarginFactory contract: ${marginFactoryContract.address}`);

    const {
        MarginFactory
    } = tracked.contracts[hre.network.name];

    const marginEthRouterContract = await tracked.deploy("MarginEthRouter", "MarginEthRouter", RESET);
    await marginEthRouterContract.initialize(
        WrappedEther.address, 
        MarginFactory.address, 
    );
    console.log(`🚜 Deployed and Initialized MarginEthRouter contract: ${marginEthRouterContract.address}`);


    // return { marginFactoryContract, marginEthRouterContract };
};

const yieldFarmContract = async () => {
    console.log("");

    const yieldFarmContract = await tracked.deploy("YieldFarm", "YieldFarm", RESET);
    const { IfexToken } = tracked.contracts[hre.network.name];
    await yieldFarmContract.initialize(IfexToken.address,);
    console.log(`🚜 Deployed and Initialized YieldFarm contract: ${yieldFarmContract.address}`);

    return { yieldFarmContract };
};

const DAY = 60 * 60 * 24;

const vaultContracts = async () => {
    console.log("")

    const { IfexToken } = tracked.contracts[hre.network.name];
    const teamReservedVaultContract = await tracked.deploy("Vault", "TeamReservedVault", RESET);
    await teamReservedVaultContract.initialize(Math.floor(Date.now() / 1000) + DAY * 180,  IfexToken.address);
    console.log(`🚜 Deployed and Initialized Team Reserved Vault contract: ${teamReservedVaultContract.address}`);

    const marketingVaultContract = await tracked.deploy("Vault", "MarketingVaultContract", RESET);
    await marketingVaultContract.initialize(Math.floor(Date.now() / 1000) + DAY * 90,  IfexToken.address);
    console.log(`🚜 Deployed and Initialized Marketing Vault contract: ${marketingVaultContract.address}`);

    const communityContract = await tracked.deploy("Vault", "CommunityVault", RESET);
    await communityContract.initialize(Math.floor(Date.now() / 1000) + DAY * 90,  IfexToken.address);
    console.log(`🚜 Deployed and Initialized Community Vault contract: ${communityContract.address}`);
}

const deploy = {
    tokenContracts,
    swapContracts,
    marginContracts,
    wrappedEtherContract,
    yieldFarmContract,
    vaultContracts,
}

async function main() {
    await initializeArtifacts();

    console.log("\n🚀 Starting Deployment");

    // await deploy.tokenContracts();
    // await deploy.wrappedEtherContract();
    // await deploy.swapContracts();
    // await deploy.marginContracts();
    await deploy.vaultContracts();
    // await deploy.yieldFarmContract();
};

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });