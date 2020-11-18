async function main() {
    const [deployer] = await ethers.getSigners();
  
    console.log(
      "Deploying contracts with the account:",
      deployer.address
    );
    
    console.log("Account balance:", (await deployer.getBalance()).toString());
  
    const Test = await ethers.getContractFactory("contracts/Swap/Test.vy:Test");
    const testContract = await Test.deploy();
  
    console.log("Test contract address:", testContract.address);
  }
  
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });