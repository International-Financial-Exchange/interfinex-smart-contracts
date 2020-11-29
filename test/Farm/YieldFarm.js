const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");

const parseTokenAmount = sendTokenAmount => ethers.utils.parseUnits(sendTokenAmount.toString(), 18);

describe("YieldFarm contract", function() {
    let yieldFarmContract, ifexTokenContract;
    let token0, token1, token3, token4;
    let owner, addr1, addr2, addrs;
  
    beforeEach(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();


        const DividendERC20 = await ethers.getContractFactory("DividendERC20");
        ifexTokenContract = await DividendERC20.deploy();
        await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, 2100000000, ifexTokenContract.address, false);

        [token0, token1, token3, token4] = await Promise.all(
            new Array(4).fill().map(async (_, i) => {
                const tokenContract = await DividendERC20.deploy();
                await tokenContract.initializeERC20(`token${i}`, `${i}`, 18, 210, ifexTokenContract.address, true,);
                return tokenContract;
            })
        );

        const  YieldFarm = await ethers.getContractFactory("YieldFarm");
        yieldFarmContract = await YieldFarm.deploy();
        await yieldFarmContract.initialize(ifexTokenContract.address);
    });
    
    it("Should initialize contract", async function() {
        expect(await yieldFarmContract.ifexTokenContract()).to.be.equal(ifexTokenContract.address);
        expect(await yieldFarmContract.owner()).to.be.equal(owner.address);
    });

    it("Should add farm", async function() {
        await yieldFarmContract.addFarm(token0.address, parseTokenAmount("100"));
        
        const expectedFarm = {
            yieldPerBlock: parseTokenAmount("100"),
            tokenContract: token0.address,
            id: BigNumber.from("1")
        };

        let { yieldPerBlock, tokenContract, id } = await yieldFarmContract.tokenToFarmInfo(token0.address)
        expect({ yieldPerBlock, tokenContract, id }).to.deep.equal(expectedFarm);
        const farmAddress = await yieldFarmContract.idToFarmTokenAddress(1);
        expect(farmAddress).to.deep.equal(token0.address);
    });

    it("Should delete farm", async function() {
        await yieldFarmContract.addFarm(token0.address, parseTokenAmount("100"));
        await yieldFarmContract.deleteFarm(token0.address);

        const expectedFarm = { 
            yieldPerBlock: BigNumber.from("0"), 
            tokenContract: ethers.constants.AddressZero,
            id: BigNumber.from("0")
        };

        const farmAddress = await yieldFarmContract.idToFarmTokenAddress(1);
        expect(farmAddress).to.deep.equal(ethers.constants.AddressZero);

        const res = await yieldFarmContract.tokenToFarmInfo(token0.address);
        const actualFarm = {
            yieldPerBlock: res.yieldPerBlock,
            tokenContract: res.tokenContract,
            id: res.id
        };
        expect(actualFarm).to.deep.equal(expectedFarm);
    });

    it("Should update farm", async function() {
        await yieldFarmContract.addFarm(token0.address, parseTokenAmount("100"));
        await yieldFarmContract.updateFarm(token0.address, parseTokenAmount("150"));

        const expectedFarm = { 
            yieldPerBlock: parseTokenAmount("150"), 
            tokenContract: token0.address,
            id: BigNumber.from("1")
        };

        const farmAddress = await yieldFarmContract.idToFarmTokenAddress(1);
        expect(farmAddress).to.deep.equal(token0.address);

        const res = await yieldFarmContract.tokenToFarmInfo(token0.address);
        const actualFarm = {
            yieldPerBlock: res.yieldPerBlock,
            tokenContract: res.tokenContract,
            id: res.id
        };
        expect(actualFarm).to.deep.equal(expectedFarm);
    });

    it("Should harvest", async function() {
        await ifexTokenContract.transfer(yieldFarmContract.address, parseTokenAmount("10000"));
        await token0.transfer(addr1.address, (await token0.balanceOf(owner.address)).div(BigNumber.from("2")));

        await yieldFarmContract.addFarm(token0.address, parseTokenAmount("100"));

        const balanceBefore = await ifexTokenContract.balanceOf(yieldFarmContract.address);
        const beforeFarm = await yieldFarmContract.tokenToFarmInfo(token0.address);
    
        await ethers.provider.send('evm_mine');
        await ethers.provider.send('evm_mine');

        await yieldFarmContract.harvest(token0.address);

        const afterFarm = await yieldFarmContract.tokenToFarmInfo(token0.address);
        
        const blockDelta = afterFarm.lastBlockUpdate.sub(beforeFarm.lastBlockUpdate);
        const expectedHarvestedAmount = blockDelta.mul(afterFarm.yieldPerBlock);

        expect(afterFarm.lastBlockUpdate).to.be.gt(beforeFarm.lastBlockUpdate);

        expect(await ifexTokenContract.balanceOf(yieldFarmContract.address)).to.be.equal(
            balanceBefore.sub(expectedHarvestedAmount)
        );

        expect(await ifexTokenContract.balanceOf(token0.address)).to.be.equal(expectedHarvestedAmount);
        expect(await token0.dividendsOf(token0.address)).to.be.equal(BigNumber.from("0"));
        
        await token0.connect(addr1).claimDividends();
        expect(await ifexTokenContract.balanceOf(addr1.address)).to.be.equal(expectedHarvestedAmount.div("2").sub(1));

        const ownerBalanceBefore = await ifexTokenContract.balanceOf(owner.address);
        await token0.connect(owner).claimDividends();
        expect(await ifexTokenContract.balanceOf(owner.address)).to.be.equal(
            ownerBalanceBefore.add(expectedHarvestedAmount.div("2")).sub(1)
        );
    });
});