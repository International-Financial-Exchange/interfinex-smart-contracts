const { ethers } = require("ethers");
const { task } = require("hardhat/config");
require('dotenv').config();

const projectDirs = JSON.parse(process.env.PROJECT_DIRS || "[]");

require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-vyper");
require("hardhat-deploy-ethers");
require("hardhat-abi-exporter");
require("./tasks/TrackedDeployer");

module.exports = {
    solidity: "0.7.3",
    vyper: {},
    abiExporter: {
        path: projectDirs,
        clear: true,
        flat: true,
        allowExternalDir: true,
    },
    sources: [
        "./contracts/external",
        "./contracts/ILO",
        "./contracts/Swap",
        "./contracts/Token",
    ],
    networks: {
        ganache: {
            url: "http://localhost:7545",
            accounts: process.env.GANACHE_KEY && [process.env.GANACHE_KEY]
        },

        kovan: {
            url: "https://kovan.infura.io/v3/f6a09cc8f51c45d2bd74137004115dbf",
            accounts: process.env.KOVAN_KEY && [process.env.KOVAN_KEY],
            gasPrice: 1000000000,
        },

        mainnet: {
            url: "https://mainnet.infura.io/v3/f6a09cc8f51c45d2bd74137004115dbf",
            accounts: process.env.MAINNET_KEY && [process.env.MAINNET_KEY],
            gasPrice: 60000000000,
        }
    },
    trackedDeploy: {
        path: projectDirs
    },
};
