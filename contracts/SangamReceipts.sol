// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title SangamReceipts
/// @notice Tamper-evident settlement receipts for Sangam's Whitechain rail.
///
/// Every USDT payment Sangam settles on Whitechain gets one receipt here:
/// the payment's transaction hash, what Sangam decided (pay out over UPI or
/// hold and refund) and the payout reference, as JSON. The contract enforces
/// the rules a receipt log needs, so nobody (Sangam included) can bend them:
///
///   - only Sangam's relayer can write;
///   - one receipt per payment transaction, ever (no double settlement);
///   - receipts are hash-chained: head = keccak256(prev head, seq, payment, keccak256(data)),
///     so dropping or reordering one breaks every head after it.
///
/// Anyone can replay the Receipt events from the explorer and recompute the
/// chain to check it ends at `head`.
contract SangamReceipts {
    /// Sangam's relayer, the only writer. Set once at deployment.
    address public immutable sangam;

    /// Number of receipts written; the last receipt's sequence number.
    uint64 public count;

    /// Hash-chain tip after the last receipt (zero before the first).
    bytes32 public head;

    /// Payment transaction hash => sequence number of its receipt (0 = none).
    mapping(bytes32 => uint64) public receiptOf;

    event Receipt(
        uint64 indexed seq,
        bytes32 indexed paymentTx,
        bytes32 prev,
        bytes32 head,
        bytes32 dataHash,
        string data
    );

    error NotSangam();
    error AlreadyRecorded(bytes32 paymentTx, uint64 seq);

    constructor() {
        sangam = msg.sender;
    }

    /// @param paymentTx The Whitechain transaction that paid the merchant.
    /// @param data      The settlement as JSON (decision, fee, payout reference, refund tx).
    function record(bytes32 paymentTx, string calldata data) external returns (uint64 seq, bytes32 newHead) {
        if (msg.sender != sangam) revert NotSangam();
        uint64 existing = receiptOf[paymentTx];
        if (existing != 0) revert AlreadyRecorded(paymentTx, existing);

        bytes32 prev = head;
        bytes32 dataHash = keccak256(bytes(data));
        seq = count + 1;
        newHead = keccak256(abi.encodePacked(prev, seq, paymentTx, dataHash));

        count = seq;
        head = newHead;
        receiptOf[paymentTx] = seq;
        emit Receipt(seq, paymentTx, prev, newHead, dataHash, data);
    }
}
