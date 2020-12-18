const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseEther } = ethers.utils;

describe("Vault contract", function() {
    let ifexTokenContract, vaultContract;
    let unlockDate;
    let owner, addr1, addr2, addrs;

    const DAY = 60 * 60 * 24;
  
    beforeEach(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        const DividendERC20 = await ethers.getContractFactory("DividendERC20");
        ifexTokenContract = await DividendERC20.deploy();
        await ifexTokenContract.initializeERC20("Interfinex Bills", "IFEX", 18, 2_100_000_000, ifexTokenContract.address, false);

        const Vault = await ethers.getContractFactory("Vault");
        vaultContract = await Vault.deploy();

        const blockTime = (await ethers.provider.getBlock()).timestamp;
        unlockDate = blockTime + DAY * 2;
        await vaultContract.initialize(unlockDate, ifexTokenContract.address);
    });

    it("Should initialize", async function() {
        expect(await vaultContract.isInitialized()).to.be.equal(true);
        expect(await vaultContract.unlockDate()).to.be.equal(unlockDate);
        expect(await vaultContract.ifexTokenContract()).to.be.equal(ifexTokenContract.address);
        expect(await vaultContract.owner()).to.be.equal(owner.address);

        await expect(vaultContract.initialize(unlockDate, ifexTokenContract.address)).to.be.revertedWith("Vault already initialized");
    });

    
    it("Should not withdraw if unlock date has not passed", async function() {
        await ifexTokenContract.transfer(vaultContract.address, parseEther("100"));
        expect(await ifexTokenContract.balanceOf(vaultContract.address)).to.be.equal(parseEther("100"));
        
        await expect(vaultContract.withdraw()).to.be.revertedWith("Vault is locked");
    });

    it("Should withdraw after unlock date has passed", async function() {
        await ethers.provider.send("evm_increaseTime", [DAY * 1]);
        await ethers.provider.send("evm_mine");

        await expect(vaultContract.withdraw()).to.be.revertedWith("Vault is locked");

        await ethers.provider.send("evm_increaseTime", [DAY * 1.1]);
        await ethers.provider.send("evm_mine");

        const ownerBalanceBefore = await ifexTokenContract.balanceOf(owner.address);
        const vaultBalanceBefore = await ifexTokenContract.balanceOf(vaultContract.address);
        await vaultContract.withdraw();

        expect(await ifexTokenContract.balanceOf(owner.address)).to.be.equal(
            ownerBalanceBefore.add(vaultBalanceBefore)
        );
        expect(await ifexTokenContract.balanceOf(vaultContract.address)).to.be.equal(0);
    });

    it("Should only allow owner to withdraw", async function() {
        await ethers.provider.send("evm_increaseTime", [DAY * 1]);
        await ethers.provider.send("evm_mine");

        await expect(vaultContract.connect(addr1).withdraw()).to.be.revertedWith("Not owner!");
    });

    it("Should change owner", async function() {
        await expect(vaultContract.connect(addr1).changeOwner(addr1.address)).to.be.revertedWith("Not owner!");
        await vaultContract.changeOwner(addr1.address);
        await vaultContract.connect(addr1).changeOwner(addr1.address);
        await expect(vaultContract.connect(owner).changeOwner(addr1.address)).to.be.revertedWith("Not owner!");

        await ethers.provider.send("evm_increaseTime", [DAY * 2]);
        await ethers.provider.send("evm_mine");

        await vaultContract.connect(addr1).withdraw();
    });
});