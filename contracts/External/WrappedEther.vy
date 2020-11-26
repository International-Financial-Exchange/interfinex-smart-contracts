name: constant(String[13])     = "Wrapped Ether"
symbol: constant(String[4])   = "WETH"
decimals: constant(uint256) = 18

balanceOf: public(HashMap[address, uint256])
allowance: public(HashMap[address, HashMap[address, uint256]])

interface WETH:
    def transferFrom(src: address, dst: address, wad: uint256) -> bool: nonpayable

@external
@payable
def deposit():
    self.balanceOf[msg.sender] += msg.value

@external
def withdraw(wad: uint256):
    assert self.balanceOf[msg.sender] >= wad, "Insuffient WETH balance"
    self.balanceOf[msg.sender] -= wad
    send(msg.sender, wad)

@external
def approve(guy: address, wad: uint256) -> bool:
    self.allowance[msg.sender][guy] = wad
    return True

@external
def transfer(dst: address, wad: uint256) -> bool:
    return WETH(self).transferFrom(msg.sender, dst, wad)

@external
def transferFrom(src: address, dst: address, wad: uint256) -> bool:
    assert self.balanceOf[src] >= wad, "Insufficient balance"

    if src != msg.sender and self.allowance[src][msg.sender] > 0:
        assert self.allowance[src][msg.sender] >= wad
        self.allowance[src][msg.sender] -= wad

    self.balanceOf[src] -= wad
    self.balanceOf[dst] += wad

    return True