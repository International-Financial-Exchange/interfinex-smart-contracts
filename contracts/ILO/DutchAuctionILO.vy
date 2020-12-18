# Created by interfinex.io
# - The Greeks

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

ONE: constant(uint256) = 10 ** 18
ONE_ETHER: constant(uint256) = ONE

@internal
@view
def mulTruncate(a: uint256, b: uint256) -> uint256:
    return a * b / ONE

interface SwapExchange:
    def mint_liquidity(
        input_token: address,
        input_token_amount: uint256, 
        min_output_token_amount: uint256, 
        max_output_token_amount: uint256, 
        recipient: address, 
        deadline: uint256
    ): nonpayable
    def swap(
        input_token: address,
        input_token_amount: uint256,
        recipient: address,
        min_output_token_amount: uint256,
        max_output_token_amount: uint256,
        deadline: uint256,
        referral: address,
        useIfex: bool,
    ) -> uint256: nonpayable
    def liquidity_token() -> address: view

interface WrappedEther:
    def deposit(): payable
    def withdraw(wad: uint256): nonpayable

interface ERC20:
    def balanceOf(_owner: address) -> uint256: view

interface DividendERC20:
    def distributeDividends(_value: uint256): nonpayable

event Invest: 
    user: indexed(address)
    investAmount: uint256
    assetTokensBought: uint256
    tokensPerEth: uint256

event Withdraw:
    user: indexed(address)
    assetTokensBought: uint256

assetToken: public(address)
assetTokenAmount: public(uint256)
startTokensPerEth: public(uint256)
endTokensPerEth: public(uint256)
startDate: public(uint256)
endDate: public(uint256)
assetSwapExchange: public(address)
ifexEthSwapExchange: public(address)
liquidityToken: public(address)
percentageToLock: public(uint256)
wrappedEther: public(address)
ifexToken: public(address)
liquidityUnlockDate: public(uint256)
creator: public(address)

balanceOf: public(HashMap[address, uint256])
etherDeposited: public(HashMap[address, uint256])
totalAssetTokensBought: public(uint256)
etherAmountRaised: public(uint256)

isInitialized: public(bool)

@external
def initialize(
    _assetToken: address, 
    _assetTokenAmount: uint256, 
    _startTokensPerEth: uint256,
    _endTokensPerEth: uint256,
    _startDate: uint256,
    _endDate: uint256,
    _assetSwapExchange: address,
    _ifexEthSwapExchange: address,
    _percentageToLock: uint256,
    _wrappedEther: address,
    _ifexToken: address,
    _liquidityUnlockDate: uint256,
    _creator: address
):
    assert self.isInitialized == False, "Already initialized"
    assert _assetToken != ZERO_ADDRESS, "Invalid asset token"
    assert _assetTokenAmount > 0, "Asset token amount too low"
    assert _startTokensPerEth > 0 and _endTokensPerEth > 0, "Start price or end price too low"
    assert _startTokensPerEth < _endTokensPerEth, "Start tokens per eth must be less than end tokens per eth"
    assert _startDate == 0 or _startDate >= block.timestamp, "Start date is in the past"
    assert _endDate == 0 or (_endDate >= block.timestamp and _endDate > _startDate), "End date is in the past"

    self.isInitialized = True
    self.assetToken = _assetToken
    self.assetTokenAmount = _assetTokenAmount
    self.startTokensPerEth = _startTokensPerEth
    self.endTokensPerEth = _endTokensPerEth
    self.startDate = _startDate
    self.endDate = _endDate
    self.assetSwapExchange = _assetSwapExchange
    self.ifexEthSwapExchange = _ifexEthSwapExchange
    self.liquidityToken = SwapExchange(self.assetSwapExchange).liquidity_token()
    self.percentageToLock = _percentageToLock
    self.wrappedEther = _wrappedEther
    self.ifexToken = _ifexToken
    self.liquidityUnlockDate = _liquidityUnlockDate
    self.creator = _creator

    self.safeTransferFrom(self.assetToken, msg.sender, self, self.assetTokenAmount)
    self.safeApprove(self.assetToken, self.assetSwapExchange, MAX_UINT256)
    self.safeApprove(self.wrappedEther, self.assetSwapExchange, MAX_UINT256)
    self.safeApprove(self.wrappedEther, self.ifexEthSwapExchange, MAX_UINT256)

@internal
@view
def _hasEnded() -> bool:
    if self.endDate > 0:
        return self.totalAssetTokensBought == self.assetTokenAmount or block.timestamp >= self.endDate
    else: 
        return self.totalAssetTokensBought == self.assetTokenAmount

@external
@view
def hasEnded() -> bool:
    return self._hasEnded()

@internal
@view
def _getCurrentTokensPerEth() -> uint256:
    # Calculate what percentage of time has passed until the endDate
    _timeDelta: uint256 = block.timestamp - self.startDate
    maxTimeRange: uint256 = self.endDate - self.startDate
    percentageComplete: uint256 = _timeDelta * ONE / maxTimeRange

    # Using percentageComplete calculate the amount to increase the tokensPerEth
    # currentTokensPerEth = startTokensPerEth + tokensPerEthRange * percentageComplete
    tokensPerEthRange: uint256 = self.endTokensPerEth - self.startTokensPerEth
    currentTokensPerEth: uint256 = self.startTokensPerEth + self.mulTruncate(tokensPerEthRange, percentageComplete)
    return currentTokensPerEth

@external
@view
def getCurrentTokensPerEth() -> uint256:
    return self._getCurrentTokensPerEth()

@external
@payable
def invest():
    assert self._hasEnded() == False, "ILO has ended"
    assert msg.value > 0, "Insufficient investment"
    assert block.timestamp >= self.startDate, "ILO has not started yet"

    tokensPerEth: uint256 = self._getCurrentTokensPerEth()

    # Calculate the amount bought
    investAmount: uint256 = msg.value
    assetTokensBought: uint256 = self.mulTruncate(msg.value, tokensPerEth)

    # Check that there are enough tokens left - If there aren't then give the max amount
    if self.totalAssetTokensBought + assetTokensBought > self.assetTokenAmount:
        # Give the investor the max amount that they can buy
        assetTokensBought = self.assetTokenAmount - self.totalAssetTokensBought
        investAmount = assetTokensBought * ONE / tokensPerEth
        # Refund the surplus ether amount
        send(msg.sender, msg.value - investAmount)

    # Credit the investors balance with the tokens that they bought
    self.balanceOf[msg.sender] += assetTokensBought
    self.etherDeposited[msg.sender] += investAmount

    # Increase the global variables with the amount bought and invested
    self.etherAmountRaised += investAmount
    self.totalAssetTokensBought += assetTokensBought

    log Invest(msg.sender, investAmount, assetTokensBought, tokensPerEth)

@external
def withdraw():
    assert self._hasEnded() == True, "ILO has not ended yet"

    assetTokensBought: uint256 = self.balanceOf[msg.sender]
    assert assetTokensBought > 0, "You did not purchase any tokens or have already withdrawn"

    # Send the user their purchased tokens
    self.safeTransfer(self.assetToken, msg.sender, assetTokensBought)

    if self.percentageToLock > 0:
        # Lock addidional liquidity in the swap pool proportional to the amount withdrawn
        etherToLock: uint256 = self.mulTruncate(self.etherDeposited[msg.sender], self.percentageToLock)
        
        # Convert ether to wrapped ether
        WrappedEther(self.wrappedEther).deposit(value=etherToLock)
        
        # Convert max amount of ether to assetTokens
        # Using the below formula:
        # https://www.wolframalpha.com/input/?i=%28+x+%28a%2F%28b%2Bx%29%29%29%2F%28z-x%29+%3D+%28a-x%28a%2F%28b%2Bx%29%29%29%2F%28b%2Bx%29%2C+solve+for+x
        exchangeEtherBalance: uint256 = ERC20(self.wrappedEther).balanceOf(self.assetSwapExchange)
        spendAmount: uint256 = convert(sqrt(convert(exchangeEtherBalance ** 2 + exchangeEtherBalance * etherToLock, decimal)), uint256) - exchangeEtherBalance
        assetTokensToLock: uint256 = SwapExchange(self.assetSwapExchange).swap(
            self.wrappedEther,
            spendAmount,
            self,
            0, 0, 0, ZERO_ADDRESS, False,
        )

        # Mint liquidity with the remaining ether amount and bought assetTokens
        SwapExchange(self.assetSwapExchange).mint_liquidity(
            self.assetToken,
            assetTokensToLock,
            0, MAX_UINT256, self, 0
        )

    # Reset the user's balances
    self.balanceOf[msg.sender] = 0
    self.etherDeposited[msg.sender] = 0
    
    log Withdraw(msg.sender, assetTokensBought)

hasCreatorWithdrawn: public(bool)

@external
def ownerWithdrawFunds(recipient: address):
    assert msg.sender == self.creator, "You are not the creator"
    assert self.hasCreatorWithdrawn == False, "You have already withdrawn"
    assert self._hasEnded() == True, "ILO has not ended"

    # Don't allow duplicate withdrawals
    self.hasCreatorWithdrawn = True

    # Calculate the amount the owner can withdraw
    amountToWithdraw: uint256 = self.mulTruncate(self.etherAmountRaised, ONE - self.percentageToLock)
    send(recipient, amountToWithdraw * 990 / 1000) # 99.0%

    # Use 0.9% of funds raised to buy ifex tokens and distribute to holders
    ifexBuyAmount: uint256 = amountToWithdraw * 9 / 1000 # 0.9%
    WrappedEther(self.wrappedEther).deposit(value=ifexBuyAmount)
    boughtIfexTokens: uint256 = SwapExchange(self.ifexEthSwapExchange).swap(
        self.wrappedEther,
        ifexBuyAmount,
        self.ifexToken,
        0, 0, 0, ZERO_ADDRESS, False,
    )

@external
def ownerWithdrawLiquidity(recipient: address):
    assert msg.sender == self.creator, "You are not the creator"
    assert self._hasEnded() == True, "ILO has not ended"
    assert block.timestamp >= self.liquidityUnlockDate, "Liquidity is still locked"

    # Send the liquidity tokens of the assetToken:wrappedEther swap exchange to the holder
    liquidityTokenAmount: uint256 = ERC20(self.liquidityToken).balanceOf(self)
    self.safeTransfer(self.liquidityToken, recipient, liquidityTokenAmount)