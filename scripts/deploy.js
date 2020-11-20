const { parseEther } = ethers.utils;
const ONE = ethers.utils.parseEther("1");

let ERC20, DividendERC20, SwapExchange, SwapFactory, MarginMarket, MarginFactory;

const initializeArtifacts = async () => {
    ERC20 = await ethers.getContractFactory("ERC20");
    DividendERC20 = await ethers.getContractFactory("DividendERC20");
    SwapExchange = await ethers.getContractFactory("Exchange");
    SwapFactory = await ethers.getContractFactory("contracts/Swap/Factory.vy:Factory");
    MarginMarket = await ethers.getContractFactory("MarginMarket");
    MarginFactory = await ethers.getContractFactory("contracts/Margin/Factory.vy:Factory");
};

const tokenContracts = async () =>  {
    console.log("");
    const tokens = await Promise.all(
        new Array(4).fill().map(async (_, i) => {
            const tokenContract = await ERC20.deploy();
            await tokenContract.initializeERC20(`token${i}`, `${i}`, 18, 2100000000, true);
            return tokenContract;
        })
    );
    console.log(`🚜 Deployed ${tokens.length} testnet ERC20 token contracts`);

    const templateDividendERC20Contract = await DividendERC20.deploy();
    console.log(`🚜 Deployed template DividendERC20 contract`);

    const ifexTokenContract = await DividendERC20.deploy();
    await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, 2100000000, ifexTokenContract.address, false);
    console.log(`🚜 Deployed testnet IFEX token contract`);

    return { tokens, templateDividendERC20Contract, ifexTokenContract };
};

const swapContracts = async (templateDividendERC20Contract, ifexTokenContract)  => {
    console.log("");
    const templateSwapExchangeContract = await SwapExchange.deploy();
    console.log(`🚜 Deployed template SwapExchange contract`);

    const swapFactoryContract = await SwapFactory.deploy();

    await swapFactoryContract.initialize_factory(
        parseEther("0.001"), 
        templateSwapExchangeContract.address, 
        templateDividendERC20Contract.address,
        ifexTokenContract.address
    );
    console.log(`🚜 Deployed and Initialized SwapFactory contract`);

    return { swapFactoryContract };
};

const marginContracts = async (templateDividendERC20Contract, ifexTokenContract, swapFactoryContract) => {
    console.log("");
    const templateMarginMarketContract = await MarginMarket.deploy();
    console.log(`🚜 Deployed template MarginMarket contract`);
    
    const marginFactoryContract = await MarginFactory.deploy();

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
    marginContracts
}

async function main() {
    await initializeArtifacts();

    console.log("\n🚀 Starting Deployment");

    const { tokens, templateDividendERC20Contract, ifexTokenContract } = await deploy.tokenContracts();
    const { swapFactoryContract } = await deploy.swapContracts(templateDividendERC20Contract, ifexTokenContract);
    const { marginFactoryContract } = await deploy.marginContracts(templateDividendERC20Contract, ifexTokenContract, swapFactoryContract);
};

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });