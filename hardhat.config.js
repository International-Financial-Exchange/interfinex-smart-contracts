const { ethers } = require("ethers");
const { task } = require("hardhat/config");
const { privateKeys, projectDirs = [] } = require("./.env.json");

require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-vyper");
require("hardhat-deploy-ethers");
require("hardhat-abi-exporter");
require("./tasks/TrackedDeployer");

module.exports = {
    solidity: "0.7.3",
    vyper: {},
    abiExporter: {
        // Can be commented out if not needed
        path: projectDirs,
        clear: true,
        flat: true,
        allowExternalDir: true,
    },
    networks: {
        ganache: {
            url: "http://localhost:7545",
            accounts: [privateKeys.ganache]
        },

        kovan: {
            url: "https://kovan.infura.io/v3/f6a09cc8f51c45d2bd74137004115dbf",
            accounts: [privateKeys.kovan],
            gasPrice: 1000000000,
        },

        mainnet: {
            url: "https://mainnet.infura.io/v3/f6a09cc8f51c45d2bd74137004115dbf",
            accounts: [privateKeys.mainnet],
            gasPrice: 60000000000,
        }
    },
    trackedDeploy: {
        path: projectDirs
    },
};
