interface DividendERC20:
    def distributeDividends(_value: uint256): nonpayable


interface ERC20:
    def approve(_spender : address, _value : uint256) -> bool: nonpayable


ifexTokenContract: public(address)
owner: public(address)

struct FarmInfo:
    yieldPerBlock: uint256
    tokenContract: address
    lastBlockUpdate: uint256
    id: uint256

farmId: public(uint256)
tokenToFarmInfo: public(HashMap[address, FarmInfo])
idToFarmTokenAddress: public(HashMap[uint256, address])

isInitialized: public(bool)

@internal
def ownable(account: address):
    assert account == self.owner, "Invalid permission"

@external
def initialize(_ifexTokenContract: address):
    assert self.isInitialized == False, "Already initialized"
    self.ifexTokenContract = _ifexTokenContract
    self.owner = msg.sender
    self.isInitialized = True

@external
def addFarm(tokenContract: address, yieldPerBlock: uint256):
    self.ownable(msg.sender)
    self.farmId += 1

    farmInfo: FarmInfo = empty(FarmInfo)
    farmInfo.yieldPerBlock = yieldPerBlock
    farmInfo.tokenContract = tokenContract
    farmInfo.id = self.farmId
    farmInfo.lastBlockUpdate = block.number

    self.tokenToFarmInfo[tokenContract] = farmInfo
    self.idToFarmTokenAddress[farmInfo.id] = farmInfo.tokenContract

    ERC20(self.ifexTokenContract).approve(tokenContract, MAX_UINT256)

@external
def deleteFarm(tokenContract: address):
    self.ownable(msg.sender)
    
    farmToDelete: FarmInfo = self.tokenToFarmInfo[tokenContract]
    self.tokenToFarmInfo[farmToDelete.tokenContract] = empty(FarmInfo)
    self.idToFarmTokenAddress[farmToDelete.id] = ZERO_ADDRESS

@external
def updateFarm(tokenContract: address, yieldPerBlock: uint256):
    self.ownable(msg.sender)

    farmToUpdate: FarmInfo = self.tokenToFarmInfo[tokenContract]
    farmToUpdate.yieldPerBlock = yieldPerBlock

    self.tokenToFarmInfo[tokenContract] = farmToUpdate
    self.idToFarmTokenAddress[farmToUpdate.id] = farmToUpdate.tokenContract

@external
def harvest(tokenContract: address):
    farmToHarvest: FarmInfo = self.tokenToFarmInfo[tokenContract]

    blockDelta: uint256 = block.number - farmToHarvest.lastBlockUpdate
    if blockDelta > 0:
        yieldAmount: uint256 = farmToHarvest.yieldPerBlock * blockDelta
        DividendERC20(farmToHarvest.tokenContract).distributeDividends(yieldAmount)
        farmToHarvest.lastBlockUpdate = block.number
        self.tokenToFarmInfo[farmToHarvest.tokenContract] = farmToHarvest
    
