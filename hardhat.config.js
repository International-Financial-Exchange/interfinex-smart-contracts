const { task } = require("hardhat/config");

require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-vyper");
require("hardhat-deploy-ethers");
require("hardhat-abi-exporter");
require("./tasks/TrackedDeployer");

module.exports = {
    solidity: "0.7.3",
    vyper: {},
    abiExporter: {
        path: [
            "/home/personal/Desktop/Projects/interfinex-frontend/public/contracts/abi",
            "/home/personal/Desktop/Projects/interfinex-backend/contracts/abi"
        ],
        clear: true,
        flat: true,
        allowExternalDir: true,
    },
    networks: {
        ganache: {
            url: "http://localhost:7545",
            accounts: ["0x48390f313c5913926e89664ca9beef2fd91a9ca28b603f500a4dd5eee269bf3a"]
        }
    },
    trackedDeploy: {
        path: [
            "/home/personal/Desktop/Projects/interfinex-frontend/public/contracts/",
            "/home/personal/Desktop/Projects/interfinex-backend/contracts/",
        ]
    },
};
