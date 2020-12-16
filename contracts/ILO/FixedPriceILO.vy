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

interface WrappedEther:
    def deposit(): payable
    def withdraw(wad: uint256): nonpayable

assetToken: public(address)
assetTokenAmount: public(uint256)
tokensPerEth: public(uint256)    
startDate: public(uint256)
endDate: public(uint256)
softCap: public(uint256)
assetSwapExchange: public(address)
percentageToLock: public(uint256)
wrappedEther: public(address)
creator: public(address)

balanceOf: public(HashMap[address, uint256])
etherDeposited: public(HashMap[address, uint256])
totalAssetTokensBought: public(uint256)

isForceEnded: public(bool)

@external
def initialize(
    _assetToken: address, 
    _assetTokenAmount: uint256, 
    _tokensPerEth: uint256, 
    _startDate: uint256,
    _endDate: uint256,
    _softCap: uint256,
    _assetSwapExchange: address,
    _percentageToLock: uint256,
    _wrappedEther: address,
    _creator: address
):
    assert _assetToken != ZERO_ADDRESS, "Invalid asset token"
    assert _assetTokenAmount > 0, "Asset token amount too low"
    assert _tokensPerEth > 0, "tokensPerEth too low"
    assert _startDate == 0 or _startDate >= block.timestamp, "Start date is in the past"
    assert _endDate == 0 or _endDate >= block.timestamp, "End date is in the past"
    assert _softCap == 0 or _endDate > 0, "Cannot set softCap if no end date is present" 

    self.assetToken = _assetToken
    self.assetTokenAmount = _assetTokenAmount
    self.tokensPerEth = _tokensPerEth
    self.startDate = _startDate
    self.endDate = _endDate
    self.softCap = _softCap
    self.assetSwapExchange = _assetSwapExchange
    self.percentageToLock = _percentageToLock
    self.wrappedEther = _wrappedEther
    self.creator = _creator

    self.safeTransferFrom(self.assetToken, msg.sender, self, self.assetTokenAmount)
    self.safeApprove(self.assetToken, self.assetSwapExchange, MAX_UINT256)
    self.safeApprove(self.wrappedEther, self.assetSwapExchange, MAX_UINT256)

@internal
def _hasEnded() -> bool:
    if self.isForceEnded == True:
        return True

    if self.endDate > 0:
        return self.totalAssetTokensBought == self.assetTokenAmount or block.timestamp >= self.endDate
    else: 
        return self.totalAssetTokensBought == self.assetTokenAmount

@internal
def _reachedSoftCap() -> bool:
    return self.totalAssetTokensBought >= self.softCap

@external
def creatorForceEnd():
    assert msg.sender == self.creator, "You are not the creator"
    self.isForceEnded = True

@external
@payable
def invest():
    assert self._hasEnded() == False, "ILO has ended"
    assert msg.value > 0, "Insufficient investment"
    assert block.timestamp >= self.startDate, "ILO has not started yet"

    # Calculate the amount bought
    investAmount: uint256 = msg.value
    assetTokensBought: uint256 = self.mulTruncate(msg.value, self.tokensPerEth) - 1 # Round down

    # Check that there are enough tokens left
    self.totalAssetTokensBought += assetTokensBought
    assert self.totalAssetTokensBought <= self.assetTokenAmount, "Not enough tokens to sell" 

    # Credit the investors balance with the tokens that they bought
    self.balanceOf[msg.sender] += assetTokensBought
    self.etherDeposited[msg.sender] = investAmount

@external
def withdraw():
    assert self._hasEnded() == True, "ILO has not ended yet"

    if self._reachedSoftCap() == True:
        assetTokensBought: uint256 = self.balanceOf[msg.sender]
        assert assetTokensBought > 0, "You did not purchase any tokens or have already withdrawn"

        # Reset the user's balance
        self.balanceOf[msg.sender] = 0

        # Send the user their purchased tokens
        self.safeTransfer(self.assetToken, msg.sender, assetTokensBought)

        # Lock addidional liquidity in the swap pool proportional to the amount withdrawn
        etherToLock: uint256 = self.etherDeposited[msg.sender] * self.percentageToLock / 100
        
        # Convert ether to wrapped ether
        WrappedEther(self.wrappedEther).deposit(value=etherToLock)
        
        # Convert 50% of locked ether amount to assetTokens
        assetTokensToLock: uint256 = SwapExchange(self.assetSwapExchange).swap(
            self.wrappedEther,
            etherToLock * 50 / 100,
            self,
            0, 0, 0, ZERO_ADDRESS, False,
        )

        # Mint liquidity with the remaining ether amount and bought assetTokens
        SwapExchange(self.assetSwapExchange).mint_liquidity(
            self.wrappedEther,
            (etherToLock * 50 / 100) - 1,
            0, 0, self, 0
        )
    else:
        # Send invested amount back to the sender if softCap has not been reached
        etherInvested: uint256 = self.etherDeposited[msg.sender]
        self.etherDeposited[msg.sender] = 0
        self.balanceOf[msg.sender] = 0
        send(msg.sender, etherInvested)



