const fs = require('fs');
const path = require('path');
require("hardhat-deploy-ethers");
require("@nomiclabs/hardhat-ethers");
const { extendEnvironment } = require("hardhat/config");

extendEnvironment((hre) => {
    const CONTRACTS_FILE = path.resolve(hre.config.paths.root, "contracts.json");
    const contractsFileExists = fs.existsSync(CONTRACTS_FILE);
    if (!contractsFileExists) {
        fs.writeFileSync(CONTRACTS_FILE, "{}");
    }

    hre.tracked = {
        contracts: JSON.parse(fs.readFileSync(CONTRACTS_FILE)),
        deploy: async function (artifactName, contractName, reset) {
            let contractInstance;
            if (!contractName) contractName = artifactName;

            const NETWORK = hre.network.name;
    
            const configPath = hre.config.trackedDeploy.path;
            const outputDirs = Array.isArray(configPath) ? configPath : [configPath];
    
            const contracts = JSON.parse(fs.readFileSync(CONTRACTS_FILE));

            if (!contracts[NETWORK] || !contracts[NETWORK][contractName] || reset) {
                const contractFactory = await ethers.getContractFactory(artifactName);
                contractInstance = await contractFactory.deploy();
                const { contractAddress, transactionHash: deploymentTransactionHash } = await contractInstance.deployTransaction.wait();
                
                if (!contracts[NETWORK]) contracts[NETWORK] = {};
                if (!contracts[NETWORK][contractName]) contracts[NETWORK][contractName] = {};
    
                contracts[NETWORK][contractName] = {
                    contractName,
                    contractAddress,
                    artifactName,
                    deploymentTransactionHash,
                };
            }
    
            const stringifiedContracts = JSON.stringify(contracts, null, 4);
            fs.writeFileSync(CONTRACTS_FILE, stringifiedContracts);
            this.contracts = contracts;
            
            for (outputDirectory of outputDirs) {
                fs.writeFileSync(path.resolve(outputDirectory, "contracts.json"), stringifiedContracts);
            }
    
            return contractInstance;
        },
    } 
});