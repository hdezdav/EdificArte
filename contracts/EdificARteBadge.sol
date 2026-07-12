// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Pausable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";

/**
 * @title EdificARteBadge
 * @notice ERC-721 NFT pausable que representa una medalla obtenida por
 *         visitar un monumento del patrimonio cultural mexicano en la app
 *         EdificARTE.
 *
 * @dev Una vez deployado en Polygon mainnet:
 *   - El owner (backend de EdificARTE) llama safeMint(to, badgeId, tokenURI)
 *     cuando un usuario registrado visita un monumento por primera vez.
 *   - El badgeId off-chain (1, 2, 3, 4 = Bellas Artes, Catedral, Torre
 *     Latinoamericana, Templo Mayor) se mapea al tokenId on-chain.
 *   - El tokenURI apunta a metadata JSON con nombre, imagen y fecha de
 *     visita.
 *   - El owner puede pausar/reanudar los mints y transfers via Pausable
 *     en caso de incidente (bug detectado, exploit, migración).
 *
 * Naming: usamos safeMint (no mintBadge) porque en OpenZeppelin Contracts
 * v5.x `tokenURI` es virtual y nombrarlo igual al param causaba shadowing
 * warning. safeMint es el nombre canónico del baseline generado por la CLI
 * de OZ y no entra en conflicto.
 */
contract EdificARteBadge is ERC721, ERC721URIStorage, ERC721Pausable, Ownable {
    /// @notice Contador auto-incremental para asignar tokenIds.
    uint256 private _nextTokenId;

    /// @notice Mapping de badgeId off-chain → último tokenId on-chain.
    /// @dev Un mismo badgeId puede tener N tokens (uno por usuario distinto);
    ///      el mapping guarda el último para indexación off-chain.
    mapping(uint256 => uint256) public badgeIdToTokenId;

    /// @notice Mapping de wallet → set de badgeIds ya minteados (anti-doble-mint).
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
     * @param uri Metadata del NFT (JSON con nombre, imagen, etc).
     * @return tokenId El ID del NFT recién minteado.
     */
    function safeMint(
        address to,
        uint256 badgeId,
        string memory uri
    ) public onlyOwner returns (uint256) {
        require(!hasMinted[to][badgeId], "Badge ya minteado para este usuario");
        require(to != address(0), "Address invalida");

        uint256 tokenId = _nextTokenId++;
        badgeIdToTokenId[badgeId] = tokenId;
        hasMinted[to][badgeId] = true;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        emit BadgeMinted(to, badgeId, tokenId, uri);
        return tokenId;
    }

    /**
     * @notice Pausa el contrato (mints, transfers). Solo el owner.
     * @dev Útil en emergencias (bug detectado, exploit). Reentrable-safe.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Reanuda el contrato después de pausar. Solo el owner.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    // The following functions are overrides required by Solidity
    // (multi-inheritance de ERC721 + ERC721URIStorage + ERC721Pausable).

    /// @inheritdoc ERC721
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Hook de transferencia: respeta Pausable. Requerido por la
    ///         herencia múltiple con ERC721Pausable.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Pausable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }
}