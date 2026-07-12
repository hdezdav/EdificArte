// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EdificARteBadge
 * @notice ERC-721 NFT que representa una medalla obtenida por visitar un
 *         monumento del patrimonio cultural mexicano en la app EdificARTE.
 *
 * @dev Una vez deployado en Polygon mainnet:
 *   - El owner (backend de EdificARTE) llama mintBadge(to, badgeId, tokenURI)
 *     cuando un usuario registrado visita un monumento por primera vez.
 *   - El badgeId off-chain (1, 2, 3, 4 = Bellas Artes, Catedral, Torre
 *     Latinoamericana, Templo Mayor) se mapea al tokenId on-chain.
 *   - El tokenURI apunta a metadata JSON con nombre, imagen y fecha de visita.
 *
 * Para deployar:
 *   1. foundry: `forge create --rpc-url $POLYGON_RPC --private-key $ADMIN_KEY
 *                src/EdificARteBadge.sol:EdificARteBadge --constructor-args <admin_addr>`
 *   2. hardhat: ver contracts/README.md
 */
contract EdificARteBadge is ERC721, ERC721URIStorage, Ownable {
    /// @dev Próximo tokenId a asignar (auto-incremental).
    uint256 private _nextTokenId;

    /// @dev Mapping de badgeId off-chain → tokenId on-chain. Permite
    ///      re-mint si el usuario pierde acceso a su wallet.
    mapping(uint256 => uint256) public badgeIdToTokenId;

    /// @dev Mapping de wallet → badgeIds que ya minteó (anti-doble-mint).
    mapping(address => mapping(uint256 => bool)) public hasMinted;

    event BadgeMinted(
        address indexed to,
        uint256 indexed badgeId,
        uint256 tokenId,
        string tokenURI
    );

    constructor(address initialOwner)
        ERC721("EdificARte Badge", "EDIFBADGE")
        Ownable(initialOwner)
    {}

    /**
     * @notice Mintea un badge NFT para un usuario que visitó un monumento.
     * @param to Address del destinatario (wallet del usuario).
     * @param badgeId ID del badge off-chain (1-4).
     * @param tokenURI Metadata del NFT (JSON con nombre, imagen, etc).
     */
    function mintBadge(
        address to,
        uint256 badgeId,
        string calldata tokenURI
    ) external onlyOwner returns (uint256) {
        require(!hasMinted[to][badgeId], "Badge ya minteado para este usuario");
        require(to != address(0), "Address invalida");

        uint256 tokenId = _nextTokenId++;
        badgeIdToTokenId[badgeId] = tokenId;
        hasMinted[to][badgeId] = true;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);

        emit BadgeMinted(to, badgeId, tokenId, tokenURI);
        return tokenId;
    }

    /**
     * @notice Devuelve el tokenURI de un tokenId. Override requerido por
     *         la doble herencia ERC721 + ERC721URIStorage en Solidity 0.8+.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    /**
     * @notice Override requerido por la doble herencia.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}