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

interface FixedPriceILO:
    def initialize(
        _assetToken: address, 
        _assetTokenAmount: uint256, 
        _tokensPerEth: uint256, 
        _startDate: uint256,
        _endDate: uint256,
        _softCap: uint256,
        _asset_swap_exchange: address,
        _ifex_eth_swap_exchange: address,
        _percentage_to_lock: uint256,
        _wrapped_ether: address,
        _ifex_token: address,
        _liquidityUnlockDate: uint256,
        _creator: address,
    ): nonpayable

interface SwapFactory: 
    def pair_to_exchange(token0: address, token1: address) -> address: view

event NewILO:
    creator: indexed(address)
    asset_token: address
    ILO_type: uint256
    ILO_contract: address

id_to_ILO: public(HashMap[uint256, address])
id_count: public(uint256)

dividend_erc20_template: public(address)
ifex_token: public(address)
swap_factory: public(address)
fixed_price_ILO_template: public(address)
wrapped_ether: public(address)
owner: public(address)

is_initialized: public(bool)

FIXED_PRICE_ILO: constant(uint256) = 1

@external
def initialize(
    _dividend_erc20_template: address,
    _ifex_token: address,
    _swap_factory: address,
    _fixed_price_ILO_template: address,
    _wrapped_ether: address,
):
    assert self.is_initialized == False, "Factory already initialized"
    self.is_initialized = True
    self.owner = msg.sender
    self.dividend_erc20_template = _dividend_erc20_template
    self.ifex_token = _ifex_token
    self.swap_factory = _swap_factory
    self.fixed_price_ILO_template = _fixed_price_ILO_template
    self.wrapped_ether = _wrapped_ether

@external
def createFixedPriceILO(
    _asset_token: address,
    _asset_token_amount: uint256,
    _tokens_per_eth: uint256, 
    _start_date: uint256,
    _end_date: uint256,
    _soft_cap: uint256,
    _percentage_to_lock: uint256,
    _liquidityUnlockDate: uint256,
):
    asset_swap_exchange: address = SwapFactory(self.swap_factory).pair_to_exchange(_asset_token, self.wrapped_ether)
    assert asset_swap_exchange != ZERO_ADDRESS, "Market does not exist"

    ifex_eth_swap_exchange: address = SwapFactory(self.swap_factory).pair_to_exchange(_asset_token, self.ifex_token)
    assert ifex_eth_swap_exchange != ZERO_ADDRESS, "IFEX asset market does not exist"

    ILOContract: address = create_forwarder_to(self.fixed_price_ILO_template)
    
    self.id_count += 1
    self.id_to_ILO[self.id_count] = ILOContract

    self.safeTransferFrom(_asset_token, msg.sender, self, _asset_token_amount)
    self.safeApprove(_asset_token, ILOContract, MAX_UINT256)

    FixedPriceILO(ILOContract).initialize(
        _asset_token,
        _asset_token_amount,
        _tokens_per_eth,
        _start_date,
        _end_date,
        _soft_cap,
        asset_swap_exchange,
        ifex_eth_swap_exchange,
        _percentage_to_lock,
        self.wrapped_ether,
        self.ifex_token,
        _liquidityUnlockDate,
        msg.sender
    )

    log NewILO(msg.sender, _asset_token, FIXED_PRICE_ILO, ILOContract)

