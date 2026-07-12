// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EdificARteReviews
 * @notice Registro público de reviews dejadas en EdificARTE. Solo emite
 *         eventos — no almacena datos pesados on-chain. La fuente de verdad
 *         sigue siendo D1 (off-chain); el evento on-chain sirve como prueba
 *         pública e inmutable de que la review existió en un momento dado.
 *
 * @dev Una vez deployado en Polygon mainnet:
 *   - El owner (backend de EdificARTE) llama emitReview() cuando un usuario
 *     autenticado deja una review en la app.
 *   - Los eventos son indexables vía The Graph o directamente en PolygonScan.
 *
 * Para deployar: igual que EdificARteBadge (ver contracts/README.md).
 */
contract EdificARteReviews is Ownable {
    event ReviewEmitted(
        address indexed author,
        string targetType,    // 'museum' | 'product' | 'tour'
        string targetId,
        uint8 rating,         // 1-5
        string reviewId       // UUID de la review en D1 (off-chain)
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Emite un evento de review para auditoría pública.
     * @param author Address del autor de la review.
     * @param targetType Tipo de target ('museum' | 'product' | 'tour').
     * @param targetId ID del target off-chain.
     * @param rating Calificación 1-5.
     * @param reviewId UUID de la review en D1.
     */
    function emitReview(
        address author,
        string calldata targetType,
        string calldata targetId,
        uint8 rating,
        string calldata reviewId
    ) external onlyOwner {
        require(author != address(0), "Author invalido");
        require(rating >= 1 && rating <= 5, "Rating fuera de rango");
        require(bytes(targetType).length > 0, "targetType vacio");
        require(bytes(targetId).length > 0, "targetId vacio");

        emit ReviewEmitted(author, targetType, targetId, rating, reviewId);
    }
}