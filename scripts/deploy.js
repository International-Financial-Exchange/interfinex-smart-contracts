const { ethers } = require("hardhat");

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
    await wrappedEtherContract.deposit({ value: parseEther("100") });

    console.log(`🚜 Deployed Wrapped Ether contract`);

    return { wrappedEtherContract };
};

const swapContracts = async (templateDividendERC20Contract, ifexTokenContract, wrappedEtherContract)  => {
    console.log("");
    const templateSwapExchangeContract = await tracked.deploy("SwapExchange", "TemplateSwapExchange", RESET);
    console.log(`🚜 Deployed template SwapExchange contract`);

    const swapFactoryContract = await tracked.deploy("SwapFactory", "SwapFactory", RESET);

    await swapFactoryContract.initialize_factory(
        parseEther("0.001"), 
        templateSwapExchangeContract.address, 
        templateDividendERC20Contract.address,
        ifexTokenContract.address
    );
    console.log(`🚜 Deployed and Initialized SwapFactory contract`);

    const swapEthRouterContract = await tracked.deploy("SwapEthRouter", "SwapEthRouter", RESET);
    await swapEthRouterContract.initialize(
        wrappedEtherContract.address, 
        swapFactoryContract.address, 
        ifexTokenContract.address
    );
    console.log(`🚜 Deployed and Initialized SwapEthRouter contract`);

    return { swapFactoryContract, swapEthRouterContract };
};

const marginContracts = async (templateDividendERC20Contract, ifexTokenContract, swapFactoryContract) => {
    console.log("");
    const templateMarginMarketContract = await tracked.deploy("MarginMarket", "templateMarginMarket", RESET);
    console.log(`🚜 Deployed template MarginMarket contract`);
    
    const marginFactoryContract = await tracked.deploy("MarginFactory", "MarginFactory", RESET);

    await marginFactoryContract.initialize(
        templateMarginMarketContract.address, 
        templateDividendERC20Contract.address, 
        ifexTokenContract.address,
        swapFactoryContract.address
    );
    console.log(`🚜 Deployed and Initialized MarginFactory contract`);

    return { marginFactoryContract };
};

const deploy = {
    tokenContracts,
    swapContracts,
    marginContracts,
    wrappedEtherContract,
}

async function main() {
    await initializeArtifacts();

    console.log("\n🚀 Starting Deployment");

    const { tokens, templateDividendERC20Contract, ifexTokenContract } = await deploy.tokenContracts();
    const { wrappedEtherContract } = await deploy.wrappedEtherContract();
    const { swapFactoryContract } = await deploy.swapContracts(templateDividendERC20Contract, ifexTokenContract, wrappedEtherContract);
    const { marginFactoryContract } = await deploy.marginContracts(templateDividendERC20Contract, ifexTokenContract, swapFactoryContract);
};

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });