# Created by interfinex.io
# - The Greeks

interface ERC20:
    def approve(_spender : address, _value : uint256) -> bool: nonpayable
    def allowance(_owner: address, _spender: address) -> uint256: view
    def transferFrom(_from : address, _to : address, _value : uint256) -> bool: nonpayable
    def initializeERC20(_name: String[64], _symbol: String[32], _decimals: uint256, _supply: uint256, _mintable: bool): nonpayable
    def balanceOf(_owner: address) -> uint256: view
    def totalSupply() -> uint256: view
    def mint(_to: address, _value: uint256): nonpayable
    def transfer(_to : address, _value : uint256) -> bool: nonpayable

interface DividendERC20:
    def initializeERC20(
        _name: String[64], 
        _symbol: String[32], 
        _decimals: uint256, 
        _supply: uint256, 
        _dividend_token: address,
        _mintable: bool
    ): nonpayable
    def burnFrom(_to: address, _value: uint256): nonpayable
    def distributeDividends(_value: uint256): nonpayable

interface SwapFactory: 
    def pair_to_exchange(token0: address, token1: address) -> address: view

interface SwapExchange:
    def getInputToOutputAmount(input_token: address, input_token_amount: uint256) -> uint256: view
    def swap(
        input_token: address,
        input_token_amount: uint256,
        recipient: address,
        min_output_token_amount: uint256,
        max_output_token_amount: uint256,
        deadline: uint256,
        referral: address,
        useIfex: bool
    ) -> uint256: nonpayable


@internal
def safeTransferFrom(_token: address, _from: address, _to: address, _value: uint256) -> bool:
    _response: Bytes[32] = raw_call(
        _token,
        concat(
            method_id("transferFrom(address,address,uint256)"),
            convert(_from, bytes32),
            convert(_to, bytes32),
            convert(_value, bytes32)
        ),
        max_outsize=32
    )

    if len(_response) > 0:
        assert convert(_response, bool), "Token transferFrom failed!"

    return True

@internal
def safeTransfer(_token: address, _to: address, _value: uint256) -> bool:
    _response: Bytes[32] = raw_call(
        _token,
        concat(
            method_id("transfer(address,uint256)"),
            convert(_to, bytes32),
            convert(_value, bytes32),
        ),
        max_outsize=32
    )

    if len(_response) > 0:
        assert convert(_response, bool), "Token transfer failed!"

    return True

@internal
@view
def subOrDefault(a: uint256, b: uint256, defaultValue: uint256) -> uint256:
    if b > a:
        return defaultValue
    return a - b    

# Each user should only be able to call each external function once per block
lastUser: address
lastBlock: uint256

@internal
def protect():
    assert self.lastUser != tx.origin or self.lastBlock != block.number, "Protected!"
    self.lastUser = tx.origin
    self.lastBlock = block.number

# Contracts
collateralToken: public(address)
assetToken: public(address)
ifexToken: public(address)
liquidityToken: public(address)
swapExchange: public(address)
swapFactory: public(address)
assetIfexSwapExchange: public(address)

# Loan info
interestIndex: public(uint256) # Accumulated interest
totalBorrowed: public(uint256) # Amount in active borrows
totalReserved: public(uint256) # Amount not in active borrows
interestRate: public(uint256)
lastUpdate: public(uint256) # The last block number since accrueInterest was called

# Parameters
interestMultiplier: public(uint256)
minInitialMarginRate: public(uint256)
maintenanceMarginRate: public(uint256)
maxBorrowAmount: public(uint256)

isInitialized: public(bool)

ONE: constant(uint256) = 10 ** 18

struct Position:
    maintenanceMargin: uint256
    borrowedAmount: uint256
    collateralAmount: uint256
    lastInterestIndex: uint256

account_to_position: public(HashMap[address, Position])

@internal
@view
def mulTruncate(a: uint256, b: uint256) -> uint256:
    return a * b / ONE

@external
def initialize(_assetToken: address, _collateralToken: address, _dividendERC20Template: address, _ifexToken: address, _swapFactory: address):
    assert self.isInitialized == False, "Market already initialized"
    self.liquidityToken = create_forwarder_to(_dividendERC20Template)
    DividendERC20(self.liquidityToken).initializeERC20("LiquidityToken", "LT", 18, 0, _ifexToken, True)
    self.ifexToken = _ifexToken
    self.assetIfexSwapExchange = SwapFactory(_swapFactory).pair_to_exchange(_ifexToken, _assetToken)
    self.assetToken = _assetToken
    self.collateralToken = _collateralToken
    self.interestIndex = ONE
    self.interestRate = 0
    self.isInitialized = True
    self.swapFactory = _swapFactory
    self.swapExchange = SwapFactory(_swapFactory).pair_to_exchange(_assetToken, _collateralToken)
    assert self.swapExchange != ZERO_ADDRESS, "Swap market does not exist for this pair"
    ERC20(_assetToken).approve(self.swapExchange, MAX_UINT256)
    ERC20(_collateralToken).approve(self.swapExchange, MAX_UINT256)
    ERC20(_assetToken).approve(self.assetIfexSwapExchange, MAX_UINT256)
    ERC20(_collateralToken).approve(self.assetIfexSwapExchange, MAX_UINT256)
    ERC20(_ifexToken).approve(_ifexToken, MAX_UINT256)
    self.maintenanceMarginRate = ONE * 15 / 100 # 15%
    self.minInitialMarginRate = ONE * 50 / 100 # 50% - Start at 2x leverage - definitely sufficient for shitcoins lmao
    self.maxBorrowAmount = ONE * 100_000_000_000 # 100 billion - Should take at most a year to normalize
    self.interestMultiplier = ONE

@internal
@view
def _pureAccrueInterest() -> (uint256, uint256):
    blockDelta: uint256 = block.number - self.lastUpdate
    if blockDelta == 0:
        return (self.totalBorrowed, self.interestIndex)

    accumulatedInterest: uint256 = blockDelta * self.interestRate
    if accumulatedInterest > 0 and self.totalBorrowed > 0: # No need to accumulate if values are 0
        return (self.totalBorrowed + self.mulTruncate(self.totalBorrowed, accumulatedInterest), self.interestIndex + self.mulTruncate(self.interestIndex, accumulatedInterest))

    return (self.totalBorrowed, self.interestIndex)

@external
@view
def pureAccrueInterest() -> (uint256, uint256):
    return self._pureAccrueInterest()

@internal
def accrueInterest():
    self.totalBorrowed, self.interestIndex = self._pureAccrueInterest()
    self.lastUpdate = block.number

@external
def testAccrueInterest():
    self.accrueInterest()

@internal
def updateInterestRate():    
    utilizationRate: uint256 = 0 # If totalBorrowed == 0 then utilizationRate will always be 0
    if self.totalBorrowed > 0 and self.totalReserved > 0:
        totalBalance: uint256 = self.totalBorrowed + self.totalReserved
        utilizationRate = ONE * self.totalBorrowed / totalBalance
    if self.totalReserved == 0 and self.totalBorrowed > 0:
        utilizationRate = ONE

    if utilizationRate == 0:
        self.interestRate = 0
        return

    self.interestRate = (self.mulTruncate(utilizationRate, self.interestMultiplier) ** 2) / ONE

@external
def deposit(_amount: uint256):
    self.protect()
    self.accrueInterest()

    mintedLiquidityAmount: uint256 = ONE
    if self.totalBorrowed + self.totalReserved > 0:
        mintedLiquidityAmount = ERC20(self.liquidityToken).totalSupply() * _amount / (self.totalBorrowed + self.totalReserved)

    self.safeTransferFrom(self.assetToken, msg.sender, self, _amount)
    ERC20(self.liquidityToken).mint(msg.sender, mintedLiquidityAmount)

    self.totalReserved += _amount
    self.updateInterestRate()

@external
def withdraw(_liquidityTokenAmount: uint256) -> uint256:
    self.protect()
    assert _liquidityTokenAmount > 0, "Withdraw amount must be greater than 0"
    self.accrueInterest()

    totalBalance: uint256 = self.totalReserved + self.totalBorrowed
    assetTokenAmount: uint256 = totalBalance * _liquidityTokenAmount / ERC20(self.liquidityToken).totalSupply()
    DividendERC20(self.liquidityToken).burnFrom(msg.sender, _liquidityTokenAmount)

    assert self.totalReserved >= assetTokenAmount, "Insufficient reserves to withdraw this amount"
    self.totalReserved -= assetTokenAmount
    self.safeTransfer(self.assetToken, msg.sender, assetTokenAmount)

    self.updateInterestRate()
    return assetTokenAmount

@view
@internal
def getOutputToInput(assetTokenAmount: uint256) -> uint256:
    assetTokenTotal: uint256 = ERC20(self.assetToken).balanceOf(self.swapExchange)
    collateralTokenTotal: uint256 = ERC20(self.collateralToken).balanceOf(self.swapExchange)
    return assetTokenAmount * collateralTokenTotal / (assetTokenTotal - assetTokenAmount)

@internal
@view
def accruePositionInterest(borrowedAmount: uint256, lastInterestIndex: uint256) -> uint256:
    if borrowedAmount == 0 or lastInterestIndex == 0:
        return 0

    multiplier: uint256 = self.interestIndex * ONE / lastInterestIndex
    return (self.mulTruncate(multiplier, borrowedAmount) - borrowedAmount) + 1 # Always round integer division UP

@external
@view
def getPosition(account: address) -> Position: 
    position: Position = self.account_to_position[account]

    tmpInterestIndex: uint256 = 0
    _: uint256 = 0
    _, tmpInterestIndex = self._pureAccrueInterest()
    accruedPositionInterest: uint256 = 0   
    if position.borrowedAmount != 0 and position.lastInterestIndex != 0:
        multiplier: uint256 = tmpInterestIndex * ONE / position.lastInterestIndex
        accruedPositionInterest = self.mulTruncate(multiplier, position.borrowedAmount) - position.borrowedAmount

    position.borrowedAmount += accruedPositionInterest
    return position

# borrow and margin inputs are both the assetToken type
@external
def increasePosition(_totalMarginAmount: uint256, _borrowAmount: uint256, minCollateralAmount: uint256, maxCollateralAmount: uint256, deadline: uint256, useIfex: bool) -> uint256:
    self.protect()
    assert _totalMarginAmount > 0 and _borrowAmount > 0, "Input amounts must be greater than 0"
    assert _borrowAmount <= self.maxBorrowAmount, "_borrowAmount is greater than maxBorrowAmount"

    self.accrueInterest()
    
    assert self.totalReserved >= _borrowAmount, "Insufficient reserves to borrow from" 
    self.safeTransferFrom(self.assetToken, msg.sender, self, _totalMarginAmount)

    assetMaintenanceMargin: uint256 = self.mulTruncate(_borrowAmount, self.maintenanceMarginRate)
    assetInitialMargin: uint256 = _totalMarginAmount - assetMaintenanceMargin
    assert assetInitialMargin * ONE / _borrowAmount > self.minInitialMarginRate, "Insufficient initial margin"

    collateralAmount: uint256 = SwapExchange(self.swapExchange).swap(self.assetToken, _borrowAmount + assetInitialMargin, self, minCollateralAmount, maxCollateralAmount, deadline, ZERO_ADDRESS, useIfex)

    new_position: Position = self.account_to_position[msg.sender]
    new_position.maintenanceMargin += assetMaintenanceMargin # Asset token
    new_position.collateralAmount += collateralAmount # Collateral token
    new_position.borrowedAmount += _borrowAmount + self.accruePositionInterest(new_position.borrowedAmount, new_position.lastInterestIndex) # Asset token
    new_position.lastInterestIndex = self.interestIndex
    self.account_to_position[msg.sender] = new_position

    immediateLiquidationAmount: uint256 = SwapExchange(self.swapExchange).getInputToOutputAmount(self.collateralToken, collateralAmount)
    assert immediateLiquidationAmount > _borrowAmount, "Liquidation would result in instant loss"

    self.totalBorrowed += _borrowAmount
    self.totalReserved -= _borrowAmount

    self.updateInterestRate()

    return new_position.collateralAmount

@internal
def _decreasePosition(_collateralTokenAmount: uint256, account: address, minAssetAmount: uint256, maxAssetAmount: uint256, deadline: uint256, useIfex: bool):
    assert _collateralTokenAmount > 0, "_collateralTokenAmount must be greater than 0"

    self.accrueInterest()

    new_position: Position = self.account_to_position[account]
    new_position.borrowedAmount += self.accruePositionInterest(new_position.borrowedAmount, new_position.lastInterestIndex) # Asset token
    new_position.lastInterestIndex = self.interestIndex

    assetTokenAmount: uint256 = SwapExchange(self.swapExchange).swap(self.collateralToken, _collateralTokenAmount, self,  minAssetAmount, maxAssetAmount, deadline, ZERO_ADDRESS, useIfex)
    if assetTokenAmount >= new_position.borrowedAmount:
        assetTokenProfit: uint256 = (assetTokenAmount - new_position.borrowedAmount) + new_position.maintenanceMargin
        self.safeTransfer(self.assetToken, account, assetTokenProfit)
        self.safeTransfer(self.collateralToken, account, new_position.collateralAmount - _collateralTokenAmount)
        self.totalReserved += new_position.borrowedAmount
        self.totalBorrowed = self.subOrDefault(self.totalBorrowed, new_position.borrowedAmount, 0)
        self.account_to_position[account] = empty(Position)
    else:
        new_position.collateralAmount -= _collateralTokenAmount
        new_position.borrowedAmount -= assetTokenAmount
        self.account_to_position[account] = new_position 
        self.totalBorrowed -= assetTokenAmount
        self.totalReserved += assetTokenAmount
    
    self.updateInterestRate()

@external
def decreasePosition(_collateralTokenAmount: uint256, minAssetAmount: uint256, maxAssetAmount: uint256, deadline: uint256, useIfex: bool):
    self.protect()
    self._decreasePosition(_collateralTokenAmount, msg.sender, minAssetAmount, maxAssetAmount, deadline, useIfex)

@external
def closePosition(minAssetAmount: uint256, maxAssetAmount: uint256, deadline: uint256, useIfex: bool):
    self.protect()
    position: Position = self.account_to_position[msg.sender]
    self._decreasePosition(position.collateralAmount, msg.sender, minAssetAmount, maxAssetAmount, deadline, useIfex)

@external
def liquidatePosition(account: address):
    self.protect()
    self.accrueInterest()
    
    position: Position = self.account_to_position[account]
    position.borrowedAmount += self.accruePositionInterest(position.borrowedAmount, position.lastInterestIndex)
    assert position.borrowedAmount > 0, "Cannot liquidate as position is not active"
    
    liquidationAmount: uint256 = 0
    if position.collateralAmount > 0:
        liquidationAmount = SwapExchange(self.swapExchange).swap(self.collateralToken, position.collateralAmount, self, 0, 0, 0, ZERO_ADDRESS, False)
        assert liquidationAmount <= position.borrowedAmount, "Position has sufficient collateral"

    remainingDebt: uint256 = position.borrowedAmount - liquidationAmount
    if remainingDebt > position.maintenanceMargin:
        remainingDebt = position.maintenanceMargin
    
    surplusAmount: uint256 = position.maintenanceMargin - remainingDebt
    liquidatorReward: uint256 = surplusAmount * 3 / 100
    ifexReward: uint256 = surplusAmount * 47 / 100
    fundingReward: uint256 = surplusAmount * 50 / 100

    self.totalReserved += liquidationAmount + remainingDebt + fundingReward
    self.totalBorrowed = self.subOrDefault(self.totalBorrowed, position.borrowedAmount, 0)

    self.account_to_position[account] = empty(Position)

    if liquidatorReward > 0:
        self.safeTransfer(self.assetToken, msg.sender, liquidatorReward)
    if ifexReward > 0:
        ifexDividends: uint256 = SwapExchange(self.assetIfexSwapExchange).swap(self.assetToken, ifexReward, self, 0, 0, 0, ZERO_ADDRESS, False)
        DividendERC20(self.ifexToken).distributeDividends(ifexDividends)

    self.updateInterestRate()

##################################################################


######################
#       Voting       #
######################

# Proposal Id's
INITIAL_MARGIN_PROPOSAL: constant(uint256) = 1
MAINTENANCE_MARGIN_PROPOSAL: constant(uint256) = 2
INTEREST_MULTIPLIER_PROPOSAL: constant(uint256) = 3
MAX_BORROW_AMOUNT_PROPOSAL: constant(uint256) = 4

# Proposal options
DOWN_OPTION: constant(uint256) = 1
PRESERVE_OPTION: constant(uint256) = 2
UP_OPTION: constant(uint256) = 3

DAY: constant(uint256) =  60 * 60 * 24

# proposal id -> vote option -> weight
proposalVotes: public(HashMap[uint256, HashMap[uint256, uint256]])
# proposal id -> vote option count
proposalVoteOptions: public(HashMap[uint256, uint256])
# proposal id -> block timestamp
proposalFinalisationDate: public(HashMap[uint256, uint256])
# user -> proposal id -> vote option -> weight
userVotes: public(HashMap[address, HashMap[uint256, HashMap[uint256, uint256]]])
# user -> proposal id -> block timestamp
userLastVote: public(HashMap[address, HashMap[uint256, uint256]])
# account -> deposit
userDeposits: public(HashMap[address, uint256])

@internal
def _withdrawVote(proposalId: uint256, voteOption: uint256, account: address):
    amount: uint256 = self.userVotes[account][proposalId][voteOption]

    self.userVotes[account][proposalId][voteOption] = 0
    self.userDeposits[account] -= amount

    ERC20(self.ifexToken).transfer(account, amount)

@external
def depositVote(proposalId: uint256, voteOption: uint256, amount: uint256):
    self.protect()
    assert voteOption <= 3, "Vote option does not exist"
    if self.proposalFinalisationDate[proposalId] == 0:
        self.proposalFinalisationDate[proposalId] = block.timestamp + DAY

    assert self.userLastVote[msg.sender][proposalId] != self.proposalFinalisationDate[proposalId], "User has already voted on this proposal"
    self._withdrawVote(proposalId, voteOption, msg.sender) # Reset user votes from previous proposals

    ERC20(self.ifexToken).transferFrom(msg.sender, self, amount)
    self.userDeposits[msg.sender] += amount
    
    if voteOption == PRESERVE_OPTION:
        self.proposalVotes[proposalId][voteOption] += amount * 150 / 100
    else:
        self.proposalVotes[proposalId][voteOption] += amount
        
    self.userLastVote[msg.sender][proposalId] = self.proposalFinalisationDate[proposalId]
    self.userVotes[msg.sender][proposalId][voteOption] += amount

@external
def withdrawVote(proposalId: uint256, voteOption: uint256):    
    self.protect()
    assert voteOption <= 3, "Vote option does not exist"
    assert self.userLastVote[msg.sender][proposalId] != self.proposalFinalisationDate[proposalId], "User is currently voting in an active proposal"

    self._withdrawVote(proposalId, voteOption, msg.sender)

# lol... Git gud

@internal
@view
def _getWinningOption(proposalId: uint256) -> (uint256, uint256): # returns (option, count)
    upVotes: uint256 = self.proposalVotes[proposalId][UP_OPTION]
    downVotes: uint256 = self.proposalVotes[proposalId][DOWN_OPTION]
    preserveVotes: uint256 = self.proposalVotes[proposalId][PRESERVE_OPTION]

    if upVotes > downVotes and upVotes > preserveVotes:
        return UP_OPTION, upVotes
    if downVotes > upVotes and downVotes > preserveVotes:
        return DOWN_OPTION, downVotes
    return PRESERVE_OPTION, preserveVotes

@external
@view
def getWinningOption(proposalId: uint256) -> (uint256, uint256):
    return self._getWinningOption(proposalId)

# Gotta set those boundries or traders will get crazy... seriously.
MAX_INITIAL_MARGIN_RATE: constant(uint256) = ONE * 10
MIN_INITIAL_MARGIN_RATE: constant(uint256) = ONE * 1 / 1000 # 0.1%
MAX_MAINTENANCE_MARGIN_RATE: constant(uint256) = ONE * 10
MIN_MAINTENANCE_MARGIN_RATE: constant(uint256) = ONE * 1 / 1000 # 0.2% - Allows 500x leverage (This better be sufficient!)
MAX_INTEREST_MULTIPLIER_RATE: constant(uint256) = ONE * 10
MIN_INTEREST_MULTIPLIER_RATE: constant(uint256) = ONE * 1 / 1000
MAX_MAX_BORROW_AMOUNT: constant(uint256) = MAX_UINT256 / 10 ** 12
MIN_MAX_BORROW_AMOUNT: constant(uint256) = 100

@external
def finalizeVote(proposalId: uint256):
    self.protect()
    assert block.timestamp >= self.proposalFinalisationDate[proposalId], "Proposal still has time left"
    assert proposalId != 0 and proposalId <= 4, "Proposal does not exist"

    winningOption: uint256 = 0
    winningVotes: uint256 = 0
    winningOption, winningVotes = self._getWinningOption(proposalId)

    if proposalId == INTEREST_MULTIPLIER_PROPOSAL:
        self.accrueInterest()

    if winningOption == UP_OPTION:
        if proposalId == INITIAL_MARGIN_PROPOSAL and self.minInitialMarginRate < MAX_INITIAL_MARGIN_RATE:
            self.minInitialMarginRate += self.minInitialMarginRate * 10 / 100
        elif proposalId == MAINTENANCE_MARGIN_PROPOSAL and self.maintenanceMarginRate < MAX_MAINTENANCE_MARGIN_RATE:
            self.maintenanceMarginRate += self.maintenanceMarginRate * 5 / 100
        elif proposalId == INTEREST_MULTIPLIER_PROPOSAL and self.interestMultiplier < MAX_INTEREST_MULTIPLIER_RATE:
            self.interestMultiplier += self.interestMultiplier * 5 / 100
        elif proposalId == MAX_BORROW_AMOUNT_PROPOSAL and self.maxBorrowAmount < MAX_MAX_BORROW_AMOUNT:
            self.maxBorrowAmount += self.maxBorrowAmount * 15 / 100
    if winningOption == DOWN_OPTION:
        if proposalId == INITIAL_MARGIN_PROPOSAL and self.minInitialMarginRate > MIN_INITIAL_MARGIN_RATE:
            self.minInitialMarginRate -= self.minInitialMarginRate * 10 / 100
        elif proposalId == MAINTENANCE_MARGIN_PROPOSAL and self.maintenanceMarginRate > MIN_MAINTENANCE_MARGIN_RATE:
            self.maintenanceMarginRate -= self.maintenanceMarginRate * 5 / 100
        elif proposalId == INTEREST_MULTIPLIER_PROPOSAL and self.interestMultiplier > MIN_INTEREST_MULTIPLIER_RATE:
            self.interestMultiplier -= self.interestMultiplier * 5 / 100
        elif proposalId == MAX_BORROW_AMOUNT_PROPOSAL and self.maxBorrowAmount > MIN_MAX_BORROW_AMOUNT:
            self.maxBorrowAmount -= self.maxBorrowAmount * 15 / 100

    if proposalId == INTEREST_MULTIPLIER_PROPOSAL:
        self.updateInterestRate()

    self.proposalVotes[proposalId][UP_OPTION] = 0
    self.proposalVotes[proposalId][DOWN_OPTION] = 0
    self.proposalVotes[proposalId][PRESERVE_OPTION] = 0

    self.proposalFinalisationDate[proposalId] = block.timestamp + DAY