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
        path: ["/home/personal/Desktop/Projects/interfinex-frontend/public/contracts/abi"],
        clear: true,
        flat: true,
        allowExternalDir: true,
    },
    trackedDeploy: {
        path: ["/home/personal/Desktop/Projects/interfinex-frontend/public/contracts/"]
    },
};
