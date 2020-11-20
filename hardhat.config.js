const { task } = require("hardhat/config");

require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-vyper");
require("hardhat-deploy-ethers");
require('hardhat-abi-exporter');

module.exports = {
    solidity: "0.7.3",
    vyper: {},
    abiExporter: {
        path: './testingpath/abi',
        clear: true,
        flat: false,
    },
};
