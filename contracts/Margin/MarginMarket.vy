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
def safeApprove(_token: address, _spender: address, _value: uint256) -> bool:
    _response: Bytes[32] = raw_call(
        _token,
        concat(
            method_id("approve(address,uint256)"),
            convert(_spender, bytes32),
            convert(_value, bytes32)
        ),
        max_outsize=32
    )

    if len(_response) > 0:
        assert convert(_response, bool), "Token approval failed!"

    return True

@internal
@view
def subOrDefault(a: uint256, b: uint256, defaultValue: uint256) -> uint256:
    if b > a:
        return defaultValue
    return a - b    

# Each user should only be able to call each external function once per block
lastUser: public(address)
lastBlock: public(uint256)

@internal
def protect():
    assert self.lastUser != tx.origin or self.lastBlock != block.number, "Protected!"
    self.lastUser = tx.origin
    self.lastBlock = block.number

event Deposit:
    user: indexed(address)
    amount: uint256

event Withdraw:
    user: indexed(address)
    amount: uint256

event IncreasePosition:
    user: indexed(address)
    borrowedAmount: uint256
    collateralToken: uint256
    maintenanceMargin: uint256

event DecreasePosition:
    user: indexed(address)
    borrowedAmount: uint256
    collateralToken: uint256
    maintenanceMargin: uint256

event LiquidatePosition:
    user: indexed(address)
    borrowedAmount: uint256
    collateralToken: uint256
    maintenanceMargin: uint256

# Contracts
collateralToken: public(address)
assetToken: public(address)
ifexToken: public(address)
liquidityToken: public(address)
swapExchange: public(address)
swapFactory: public(address)
assetIfexSwapExchange: public(address)

# owner -> spender -> isAuthorized
isAuthorized: public(HashMap[address, HashMap[address, bool]])

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
maxBorrowAmountRate: public(uint256)
maxLiquidateVolumeRate: public(uint256)

currentBlockLiquidations: public(uint256)
lastLiquidateBlock: public(uint256)
currentBlockBorrows: public(uint256)
lastBorrowBlock: public(uint256)

DAY: constant(uint256) =  60 * 60 * 24
votingDuration: public(uint256) 

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
    self.safeApprove(_assetToken, self.swapExchange, MAX_UINT256)
    self.safeApprove(_collateralToken, self.swapExchange, MAX_UINT256)
    if self.assetIfexSwapExchange != self.swapExchange:
        self.safeApprove(_assetToken, self.assetIfexSwapExchange, MAX_UINT256)
    self.safeApprove(_ifexToken, _ifexToken, MAX_UINT256)
    self.maintenanceMarginRate = ONE * 15 / 100 # 15%
    self.minInitialMarginRate = ONE * 50 / 100 # 50% - Start at 2x leverage - definitely sufficient for shitcoins lmao
    self.maxBorrowAmountRate = ONE * 50 / 100 # 50%
    self.votingDuration = DAY * 3
    self.maxLiquidateVolumeRate = ONE * 50 / 100
    self.interestMultiplier = ONE

@internal
@view
def _pureAccrueInterest() -> (uint256, uint256):
    """
    @dev    Calculate the accrued interest of the total borrows.

            totalBorrowed = (blockDelta * interestRate * totalBorrowed) + totalBorrowed
            interestIndex = (blockDelta * interestRate * interestIndex) + interestIndex
                where:
            blockDelta = amount of blocks since last interest accrue update

    @return (newTotalBorrowed, newInterestIndex)
    """
    blockDelta: uint256 = block.number - self.lastUpdate
    if blockDelta == 0:
        return (self.totalBorrowed, self.interestIndex)

    accumulatedInterest: uint256 = blockDelta * self.interestRate
    if accumulatedInterest > 0 and self.totalBorrowed > 0: # No need to accumulate if values are 0
        return (self.totalBorrowed + self.mulTruncate(self.totalBorrowed, accumulatedInterest), self.interestIndex + self.mulTruncate(self.interestIndex, accumulatedInterest) + 1)

    return (self.totalBorrowed, self.interestIndex)

@external
@view
def pureAccrueInterest() -> (uint256, uint256):
    return self._pureAccrueInterest()

@internal
def accrueInterest():
    """
    @dev    Updates the totalBorrowed and interestIndex via accruing the interest.
    """
    self.totalBorrowed, self.interestIndex = self._pureAccrueInterest()
    self.lastUpdate = block.number

# @external
# def testAccrueInterest():
#     self.accrueInterest()

@internal
def updateInterestRate(): 
    """
    @dev    Updates the interest rate of the contract.

            interestRate = (utilizationRate * interestMultiplier) ^ 2 / BLOCKS_IN_A_YEAR
                where:
            utilizationRate = totalBorrowed / (totalReserved + totalBorrowed)
            interestMultiplier = parameter which is voted on every ~3 days
            BLOCKS_IN_A_YEAR = 2336000
    """   
    utilizationRate: uint256 = 0 # If totalBorrowed == 0 then utilizationRate will always be 0
    if self.totalBorrowed > 0 and self.totalReserved > 0:
        totalBalance: uint256 = self.totalBorrowed + self.totalReserved
        utilizationRate = ONE * self.totalBorrowed / totalBalance
    if self.totalReserved == 0 and self.totalBorrowed > 0:
        utilizationRate = ONE

    if utilizationRate == 0:
        self.interestRate = 0
        return

    self.interestRate = ((self.mulTruncate(utilizationRate, self.interestMultiplier) ** 2) / ONE) / 2336000

@external
def deposit(_amount: uint256) -> uint256:
    """
    @dev    Deposits funding into the contract which can be borrowed by traders and
            sends liquidity tokens to the depositer that can be claimed at a later date.

            mintedLiquidityAmount = totalLiquidityAmount * _amount / (totalBorrowed + totalReserved)

    @param _amount the amount of assetTokens deposited 
    """  
    self.protect()
    self.accrueInterest()

    mintedLiquidityAmount: uint256 = ONE
    if self.totalBorrowed + self.totalReserved > 0:
        mintedLiquidityAmount = ERC20(self.liquidityToken).totalSupply() * _amount / (self.totalBorrowed + self.totalReserved)

    self.safeTransferFrom(self.assetToken, msg.sender, self, _amount)
    ERC20(self.liquidityToken).mint(msg.sender, mintedLiquidityAmount)

    self.totalReserved += _amount
    self.updateInterestRate()

    log Deposit(msg.sender, _amount)
    return mintedLiquidityAmount

@external
def withdraw(_liquidityTokenAmount: uint256) -> uint256:
    """
    @dev    Withdraws funding from the contract totalReserved amount.
            Amount to be withdrawn can never be more than the totalReserved though a user may have claim
            to more funds than is in the totalReserved; They will have to wait until totalReserved increases.

            totalContractBalance = totalBorrowed + totalReserved
            fractionOfLiquidityOwned = _liquidityTokenAmount / totalLiquidityAmount
            withdrawAmount = fractionOfLiquidityOwned * totalContractBalance

    @param _liquidityTokenAmount the amount of liquidity tokens to burn 
    """  
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

    log Withdraw(msg.sender, assetTokenAmount)
    return assetTokenAmount

@view
@internal
def getOutputToInput(assetTokenAmount: uint256) -> uint256:
    """
    @dev    Util function for calculating the swap exchange rate.
            Answers: "How much `collateralTokenAmount` do I need to pay to receive `assetTokenAmount` asset tokens?"

    @param assetTokenAmount the amount of assetTokens to buy 
    """ 
    assetTokenTotal: uint256 = ERC20(self.assetToken).balanceOf(self.swapExchange)
    collateralTokenTotal: uint256 = ERC20(self.collateralToken).balanceOf(self.swapExchange)
    return assetTokenAmount * collateralTokenTotal / (assetTokenTotal - assetTokenAmount)

@internal
@view
def accruePositionInterest(borrowedAmount: uint256, lastInterestIndex: uint256) -> uint256:
    """
    @dev    Calculates the amount that a position has borrowed by accumulating
            the interest on his borrowed amount.

            newBorrowedAmount = borrowedAmount * interestIndex / lastInterestIndex 

    @param borrowedAmount the amount the user has borrowed so far 
    @param lastInterestIndex most recent interestIndex at which his borrowed amount was updated
    """ 
    if borrowedAmount == 0 or lastInterestIndex == 0:
        return 0

    multiplier: uint256 = self.interestIndex * ONE / lastInterestIndex
    return (self.mulTruncate(multiplier, borrowedAmount) - borrowedAmount) + 1 # Always round integer division UP

@external
@view
def getPosition(account: address) -> Position: 
    """
    @dev    Util function for use by dapps to easily fetch the current position of an account.
            This function is not used by this smart contract; It's only intended for external use.

    @param account the intended position to fetch 
    """ 
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

@external
def authorize(spender: address):
    """
    @dev Authorizes an account to open positions on the msg.sender's behalf
    """ 
    self.isAuthorized[msg.sender][spender] = True

@external
def deauthorize(spender: address):
    """
    @dev Deauthorizes an account from opening positions on the msg.sender's behalf
    """ 
    self.isAuthorized[msg.sender][spender] = False

# borrow and margin inputs are both the assetToken type
@external
def increasePosition(
    _totalMarginAmount: uint256, 
    _borrowAmount: uint256, 
    minCollateralAmount: uint256, 
    maxCollateralAmount: uint256, 
    deadline: uint256, 
    useIfex: bool,
    account: address
) -> uint256:    
    """
    @dev    Increases the position of an account.
            The account's position is then updated using the following calculations:
            
            maintenanceMargin = _borrowAmount * maintenanceMarginRate -- Asset Token
            initialMargin = _totalMarginAmount - maintenanceMargin -- Asset Token
            collateralAmount += swap(_borrowAmount + initialMargin) -- Collateral Token
            borrowedAmount += _borrowAmount + accrueInterest(borrowedAmount)
            lastInterestIndex = interestIndex
                where:
            swap() = a function that swaps asset token to collateral tokens using an external swap contract
            accrueInterest() = self.accruePositionInterest

            totalReserved, totalBorrowed and interestRate are then all updated too.

    @param _totalMarginAmount Amount of margin to post which determines the leverage of the position 
    @param _borrowAmount Amount to borrow
    @param account The account which is opening/increasing the position
    """ 
    self.protect()

    assert msg.sender == account or self.isAuthorized[account][msg.sender] == True, "Account not authorized"
    assert _totalMarginAmount > 0 and _borrowAmount > 0, "Input amounts must be greater than 0"

    if block.number != self.lastBorrowBlock:
        self.lastBorrowBlock = block.number
        self.currentBlockBorrows = 0

    self.currentBlockBorrows += _borrowAmount
    assert self.currentBlockBorrows <= self.mulTruncate(self.totalBorrowed + self.totalReserved, self.maxBorrowAmountRate), "currentBlockBorrows is greater than max borrow amount"

    self.accrueInterest()
    
    assert self.totalReserved >= _borrowAmount, "Insufficient reserves to borrow from" 
    self.safeTransferFrom(self.assetToken, msg.sender, self, _totalMarginAmount)

    assetMaintenanceMargin: uint256 = self.mulTruncate(_borrowAmount, self.maintenanceMarginRate)
    assetInitialMargin: uint256 = _totalMarginAmount - assetMaintenanceMargin
    assert assetInitialMargin * ONE / _borrowAmount > self.minInitialMarginRate, "Insufficient initial margin"

    collateralAmount: uint256 = SwapExchange(self.swapExchange).swap(self.assetToken, _borrowAmount + assetInitialMargin, self, minCollateralAmount, maxCollateralAmount, deadline, ZERO_ADDRESS, useIfex)

    new_position: Position = self.account_to_position[account]
    new_position.maintenanceMargin += assetMaintenanceMargin # Asset token
    new_position.collateralAmount += collateralAmount # Collateral token
    new_position.borrowedAmount += _borrowAmount + self.accruePositionInterest(new_position.borrowedAmount, new_position.lastInterestIndex) # Asset token
    new_position.lastInterestIndex = self.interestIndex
    self.account_to_position[account] = new_position

    immediateLiquidationAmount: uint256 = SwapExchange(self.swapExchange).getInputToOutputAmount(self.collateralToken, collateralAmount)
    assert immediateLiquidationAmount > _borrowAmount, "Liquidation would result in instant loss"

    self.totalBorrowed += _borrowAmount
    self.totalReserved -= _borrowAmount

    self.updateInterestRate()

    log IncreasePosition(account, new_position.borrowedAmount, new_position.collateralAmount, new_position.maintenanceMargin)
    return new_position.collateralAmount

@internal
def _decreasePosition(
    _collateralTokenAmount: uint256, 
    account: address, 
    minAssetAmount: uint256, 
    maxAssetAmount: uint256, 
    deadline: uint256, 
    useIfex: bool, 
    recipient: address
):
    """
    @dev    Decreases the position of an account.
            First we convert the _collateralTokenAmount into assetTokens

            assetTokensBought = swap(_collateralTokenAmount)

            if the assetTokensBought is greater than the borrowedAmount then the position is closed,
            and the maintenance margin is refunded plus assetTokensBought - position.borrowedAmount
        
            if the assetTokensBought is less than the borrowed amount then the position is updated like so:

            collateralAmount -= _collateralTokenAmount
            borrowedAmount -= assetTokensBought

            totalReserved, totalBorrowed and interestRate are then all updated too.
            
    @param _collateralTokenAmount Amount of collateral to sell 
    @param _account Account whose position to update
    @param recipient The account to receive any potential profit
    """ 
    assert _collateralTokenAmount > 0, "_collateralTokenAmount must be greater than 0"

    self.accrueInterest()

    new_position: Position = self.account_to_position[account]
    assert new_position.collateralAmount >= _collateralTokenAmount, "Insufficient collateral"

    new_position.borrowedAmount += self.accruePositionInterest(new_position.borrowedAmount, new_position.lastInterestIndex) # Asset token
    new_position.lastInterestIndex = self.interestIndex

    assetTokenAmount: uint256 = SwapExchange(self.swapExchange).swap(self.collateralToken, _collateralTokenAmount, self,  minAssetAmount, maxAssetAmount, deadline, ZERO_ADDRESS, useIfex)
    if assetTokenAmount >= new_position.borrowedAmount:
        assetTokenProfit: uint256 = (assetTokenAmount - new_position.borrowedAmount) + new_position.maintenanceMargin
        self.safeTransfer(self.assetToken, recipient, assetTokenProfit)
        self.safeTransfer(self.collateralToken, recipient, new_position.collateralAmount - _collateralTokenAmount)
        self.totalReserved += new_position.borrowedAmount
        # Sum of all position borrows should always be greater than totalBorrowed because we round the position accrue interest 
        # calculation up by 1 whenver there is integer division; So subOrDefault here prevents an underflow error.
        self.totalBorrowed = self.subOrDefault(self.totalBorrowed, new_position.borrowedAmount, 0)
        self.account_to_position[account] = empty(Position)
    else:
        new_position.collateralAmount -= _collateralTokenAmount
        new_position.borrowedAmount -= assetTokenAmount
        self.account_to_position[account] = new_position 
        self.totalBorrowed -= assetTokenAmount
        self.totalReserved += assetTokenAmount
    
    self.updateInterestRate()
    log DecreasePosition(account, new_position.borrowedAmount, new_position.collateralAmount, new_position.maintenanceMargin)

@external
def decreasePosition(_collateralTokenAmount: uint256, minAssetAmount: uint256, maxAssetAmount: uint256, deadline: uint256, useIfex: bool, account: address):
    self.protect()
    assert msg.sender == account or self.isAuthorized[account][msg.sender] == True, "Account not authorized"
    self._decreasePosition(_collateralTokenAmount, account, minAssetAmount, maxAssetAmount, deadline, useIfex, msg.sender)

@external
def closePosition(minAssetAmount: uint256, maxAssetAmount: uint256, deadline: uint256, useIfex: bool, account: address):
    self.protect()
    assert msg.sender == account or self.isAuthorized[account][msg.sender] == True, "Account not authorized"

    position: Position = self.account_to_position[account]
    self._decreasePosition(position.collateralAmount, account, minAssetAmount, maxAssetAmount, deadline, useIfex, msg.sender)

@external
def liquidatePosition(account: address):
    """
    @dev    Attempts to liquidate the position of an account
            
            Attempt to sell 100% of the position.collateralAmount of the account and get assetTokens:
                liquidationAmount = swap(position.collateralAmount)
            
            If (liquidationAmount < position.borrowedAmount) then the account can be liquidated.
            
            remainingDebt = max(borrowedAmount - liquidationAmount, position.maintenanceMargin)
            surplusAmount = position.maintenanceMargin - remainingDebt

            if (surplusAmount > 0) then it is distributed accordingly:
                surplusAmount * 3% goes to liquidator
                surplusAmount * 47% is converted to ifex and distributed as dividends
                surplusAmount * 50% is added to the totalReserved

            The account's position is then emptied and reset.
    @param account Position to be liquidated
    """ 
    self.protect()
    self.accrueInterest()
    assert msg.sender == tx.origin # Prevent flash swap attacks
    
    # Update the accouns borrowedAmount
    position: Position = self.account_to_position[account]
    position.borrowedAmount += self.accruePositionInterest(position.borrowedAmount, position.lastInterestIndex)
    assert position.borrowedAmount > 0, "Cannot liquidate as position is not active"
    
    # Attempt to liquidate
    liquidationAmount: uint256 = 0
    if position.collateralAmount > 0:
        liquidationAmount = SwapExchange(self.swapExchange).swap(self.collateralToken, position.collateralAmount, self, 0, 0, 0, ZERO_ADDRESS, False)
        assert liquidationAmount <= position.borrowedAmount, "Position has sufficient collateral"

    # Prevent too many liquidations from happening in a single block
    assert self.currentBlockLiquidations <= self.mulTruncate(self.totalReserved + self.totalBorrowed, self.maxLiquidateVolumeRate) or block.number != self.lastLiquidateBlock, "Too many liquidations in this block"
    if block.number != self.lastLiquidateBlock:
        self.lastLiquidateBlock = block.number
        self.currentBlockLiquidations = 0
    self.currentBlockLiquidations += position.borrowedAmount

    remainingDebt: uint256 = position.borrowedAmount - liquidationAmount
    if remainingDebt > position.maintenanceMargin:
        remainingDebt = position.maintenanceMargin

    # Rewards    
    surplusAmount: uint256 = position.maintenanceMargin - remainingDebt
    liquidatorReward: uint256 = surplusAmount * 3 / 100
    ifexReward: uint256 = surplusAmount * 47 / 100
    fundingReward: uint256 = surplusAmount * 50 / 100

    self.totalReserved += liquidationAmount + remainingDebt + fundingReward
    self.totalBorrowed = self.subOrDefault(self.totalBorrowed, position.borrowedAmount, 0)

    # Reset the position
    self.account_to_position[account] = empty(Position)

    if liquidatorReward > 0:
        self.safeTransfer(self.assetToken, msg.sender, liquidatorReward)
    if ifexReward > 0:
        ifexDividends: uint256 = SwapExchange(self.assetIfexSwapExchange).swap(self.assetToken, ifexReward, self, 0, 0, 0, ZERO_ADDRESS, False)
        DividendERC20(self.ifexToken).distributeDividends(ifexDividends)

    self.updateInterestRate()
    log LiquidatePosition(account, position.borrowedAmount, position.collateralAmount, position.maintenanceMargin)

##################################################################


######################
#       Voting       #
######################

# Proposal Id's
INITIAL_MARGIN_PROPOSAL: constant(uint256) = 1
MAINTENANCE_MARGIN_PROPOSAL: constant(uint256) = 2
INTEREST_MULTIPLIER_PROPOSAL: constant(uint256) = 3
MAX_BORROW_AMOUNT_RATE_PROPOSAL: constant(uint256) = 4
MAX_LIQUIDATE_VOLUME_RATE_PROPOSAL: constant(uint256) = 5
VOTING_DURATION_PROPOSAL: constant(uint256) = 6

# Proposal options
DOWN_OPTION: constant(uint256) = 1
PRESERVE_OPTION: constant(uint256) = 2
UP_OPTION: constant(uint256) = 3

# proposal id -> vote option -> weight
proposalVotes: public(HashMap[uint256, HashMap[uint256, uint256]])
# proposal id -> vote option count
proposalVoteOptions: public(HashMap[uint256, uint256])
# proposal id -> option count
proposalBaselineVote: public(HashMap[uint256, uint256])
# proposal id -> block timestamp
proposalFinalisationDate: public(HashMap[uint256, uint256])
# user -> proposal id -> weight
userVotes: public(HashMap[address, HashMap[uint256, uint256]])
# user -> proposal id -> block timestamp
userLastVote: public(HashMap[address, HashMap[uint256, uint256]])
# account -> deposit
userDeposits: public(HashMap[address, uint256])

@internal
def _withdrawVote(proposalId: uint256, account: address):
    amount: uint256 = self.userVotes[account][proposalId]

    self.userVotes[account][proposalId] = 0
    self.userDeposits[account] -= amount

    ERC20(self.ifexToken).transfer(account, amount)

@external
def depositVote(proposalId: uint256, voteOption: uint256, amount: uint256):
    self.protect()
    assert voteOption <= 3, "Vote option does not exist"
    if self.proposalFinalisationDate[proposalId] == 0:
        self.proposalFinalisationDate[proposalId] = block.timestamp + self.votingDuration

    assert self.userLastVote[msg.sender][proposalId] != self.proposalFinalisationDate[proposalId], "User has already voted on this proposal"
    self._withdrawVote(proposalId, msg.sender) # Reset user votes from previous proposals

    ERC20(self.ifexToken).transferFrom(msg.sender, self, amount)
    self.userDeposits[msg.sender] += amount
    
    # Preserve votes hold 1.5x the weight of increase/decrease votes
    if voteOption == PRESERVE_OPTION:
        self.proposalVotes[proposalId][voteOption] += amount * 150 / 100
    else:
        self.proposalVotes[proposalId][voteOption] += amount
        
    self.userLastVote[msg.sender][proposalId] = self.proposalFinalisationDate[proposalId]
    self.userVotes[msg.sender][proposalId] = amount

@external
def withdrawVote(proposalId: uint256,):    
    self.protect()
    assert self.userLastVote[msg.sender][proposalId] != self.proposalFinalisationDate[proposalId], "User is currently voting in an active proposal"

    self._withdrawVote(proposalId, msg.sender)

@internal
@view
def _getWinningOption(proposalId: uint256) -> (uint256, uint256): # returns (option, count)
    """
    @dev Get the option with the highest amount of votes
    @param proposalId proposal to get the winning option from
    """ 
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

# Gotta set those boundries or traders will get crazy...
MAX_INITIAL_MARGIN_RATE: constant(uint256) = ONE * 10
MIN_INITIAL_MARGIN_RATE: constant(uint256) = ONE * 1 / 1000 # 0.1%
MAX_MAINTENANCE_MARGIN_RATE: constant(uint256) = ONE * 10
MIN_MAINTENANCE_MARGIN_RATE: constant(uint256) = ONE * 1 / 1000 # 0.1% - Allows 500x leverage incl. maintenance margin (This better be sufficient!)
MAX_INTEREST_MULTIPLIER_RATE: constant(uint256) = ONE * 20
MIN_INTEREST_MULTIPLIER_RATE: constant(uint256) = ONE * 1 / 1000
MAX_MAX_BORROW_AMOUNT_RATE: constant(uint256) = ONE * 90 / 100 # 90%
MIN_MAX_BORROW_AMOUNT_RATE: constant(uint256) = ONE * 1 / 1000 # 0.1%
MAX_MAX_LIQUIDATE_VOLUME_RATE: constant(uint256) = ONE * 90 / 100
MIN_MAX_LIQUIDATE_VOLUME_RATE: constant(uint256) = ONE * 1 / 1000 # 0.1%
MAX_VOTING_DURATION: constant(uint256) = DAY * 14
MIN_VOTING_DURATION: constant(uint256) = DAY / 2 # 12 hours - just in case of some NTP server consensus error or such.

@external
def finalizeVote(proposalId: uint256):
    """
    @dev    Finalize the vote for a given proposal then update the respective parameter by either
            increasing, decreasing or preserving it's value depending on the vote outcome.
            
            If the winning vote was to decrease or increase then update the baseline vote count to be
            90% of the winning vote. If the winning vote was to preserve then keep the baseline vote
            count as it is and don't change it. 
            
            Reset the increase and decrease vote counts to 0 and then set the preserve vote count to be the baseline vote count.

    @param proposalId proposal to finalize
    """ 
    self.protect()
    assert block.timestamp >= self.proposalFinalisationDate[proposalId], "Proposal still has time left"
    assert proposalId != 0 and proposalId <= 4, "Proposal does not exist"

    winningOption: uint256 = 0
    winningVotes: uint256 = 0
    winningOption, winningVotes = self._getWinningOption(proposalId)

    self.accrueInterest()

    if winningOption == UP_OPTION:
        if proposalId == INITIAL_MARGIN_PROPOSAL and self.minInitialMarginRate < MAX_INITIAL_MARGIN_RATE:
            self.minInitialMarginRate += self.minInitialMarginRate * 10 / 100
        elif proposalId == MAINTENANCE_MARGIN_PROPOSAL and self.maintenanceMarginRate < MAX_MAINTENANCE_MARGIN_RATE:
            self.maintenanceMarginRate += self.maintenanceMarginRate * 5 / 100
        elif proposalId == INTEREST_MULTIPLIER_PROPOSAL and self.interestMultiplier < MAX_INTEREST_MULTIPLIER_RATE:
            self.interestMultiplier += self.interestMultiplier * 5 / 100
        elif proposalId == MAX_BORROW_AMOUNT_RATE_PROPOSAL and self.maxBorrowAmountRate < MAX_MAX_BORROW_AMOUNT_RATE:
            self.maxBorrowAmountRate += self.maxBorrowAmountRate * 10 / 100
        elif proposalId == MAX_LIQUIDATE_VOLUME_RATE_PROPOSAL and self.maxLiquidateVolumeRate < MAX_MAX_LIQUIDATE_VOLUME_RATE:
            self.maxLiquidateVolumeRate += self.maxLiquidateVolumeRate * 10 / 100
        elif proposalId == VOTING_DURATION_PROPOSAL and self.votingDuration < MAX_VOTING_DURATION:
            self.votingDuration += self.votingDuration * 15 / 100
    if winningOption == DOWN_OPTION:
        if proposalId == INITIAL_MARGIN_PROPOSAL and self.minInitialMarginRate > MIN_INITIAL_MARGIN_RATE:
            self.minInitialMarginRate -= self.minInitialMarginRate * 10 / 100
        elif proposalId == MAINTENANCE_MARGIN_PROPOSAL and self.maintenanceMarginRate > MIN_MAINTENANCE_MARGIN_RATE:
            self.maintenanceMarginRate -= self.maintenanceMarginRate * 5 / 100
        elif proposalId == INTEREST_MULTIPLIER_PROPOSAL and self.interestMultiplier > MIN_INTEREST_MULTIPLIER_RATE:
            self.interestMultiplier -= self.interestMultiplier * 5 / 100
        elif proposalId == MAX_BORROW_AMOUNT_RATE_PROPOSAL and self.maxBorrowAmountRate > MIN_MAX_BORROW_AMOUNT_RATE:
            self.maxBorrowAmountRate -= self.maxBorrowAmountRate * 10 / 100
        elif proposalId == MAX_LIQUIDATE_VOLUME_RATE_PROPOSAL and self.maxLiquidateVolumeRate > MIN_MAX_LIQUIDATE_VOLUME_RATE:
            self.maxLiquidateVolumeRate -= self.maxLiquidateVolumeRate * 10 / 100
        elif proposalId == VOTING_DURATION_PROPOSAL and self.votingDuration > MIN_VOTING_DURATION:
            self.votingDuration -= self.votingDuration * 15 / 100

    self.updateInterestRate()

    self.proposalVotes[proposalId][UP_OPTION] = 0
    self.proposalVotes[proposalId][DOWN_OPTION] = 0

    if winningOption == PRESERVE_OPTION:
        baselineVote: uint256 = self.proposalBaselineVote[proposalId]
        self.proposalVotes[proposalId][PRESERVE_OPTION] = baselineVote
    else:
        newBaselineVote: uint256 = winningVotes * 90 / 100
        self.proposalBaselineVote[proposalId] = newBaselineVote
        self.proposalVotes[proposalId][PRESERVE_OPTION] = newBaselineVote

    self.proposalFinalisationDate[proposalId] = block.timestamp + self.votingDuration