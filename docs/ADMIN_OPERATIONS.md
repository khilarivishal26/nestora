# Nestora — Admin Operations Manual & Checklist

This manual details the standard operating procedures (SOP) for Nestora platform administrators to oversee property listings, manage guest bookings, verify financial transactions, process cancellations/refunds, and audit system activities.

---

## 1. Accessing the Admin Console

- **URL:** `https://<your-domain>/admin`
- **RBAC Requirement:** User must have `role: "admin"` and verified email.
- **Audit Logs URL:** `https://<your-domain>/admin/audit-logs`

---

## 2. Admin Operational Workflows

### 2.1 Listing Review & Approval / Rejection
1. Navigate to `/admin`.
2. Review the **Pending Approval** section.
3. Click on a listing to inspect:
   - Title, descriptions, location, and nightly price.
   - Cloudinary uploaded images (check for content policy compliance).
   - Max guests, amenities, and cancellation policy (`flexible`, `moderate`, `strict`).
4. **Approve Listing:**
   - Click **Approve Property**.
   - Action: Listing status becomes `approved`, immediately appearing in Explore Stays search.
   - Host receives approval notification email automatically.
5. **Reject Listing:**
   - Click **Reject Property**.
   - Action: Listing status becomes `rejected`, remaining hidden from public search.
   - Audit trail records `listing.rejected`.

---

### 2.2 Booking & Reservation Inspection
1. Navigate to `/admin` &rarr; Click on any Booking ID or view from Host/Guest details.
2. Verify:
   - **Reservation Status:** `pending`, `confirmed`, `cancelled`, or `expired`.
   - **Payment Status:** `pending`, `paid`, `failed`, `refunded`.
   - **Check-in / Check-out Dates:** Date ranges held in `DailyAvailability`.
   - **Financial Breakdown:** Accommodation total, 5% Nestora commission, Net Host Payout.

---

### 2.3 Payment & Razorpay Transaction Verification
1. Open the booking details page `/bookings/:id`.
2. Inspect the linked Payment record:
   - `razorpayOrderId`: Gateway order identifier.
   - `razorpayPaymentId`: Verified capture ID.
   - `amount`: Transaction amount in INR.
   - `currency`: INR.
3. Cross-reference `razorpayPaymentId` in the Razorpay Dashboard to verify fund capture status.

---

### 2.4 Cancellation & Refund Processing
1. When an authorized guest or admin initiates a cancellation:
   - The system calculates the refund tier based on the listing policy (`flexible`, `moderate`, `strict`) and the remaining hours before check-in.
2. The refund gateway operation executes via `refundService.processRazorpayRefund`.
3. Verify status:
   - `completed`: Verified with gateway refund ID stored in `razorpayRefundId`.
   - `pending`: Awaiting webhook receipt.
   - `ineligible`: Policy dictated 0% refund.
4. The system releases inventory dates in `DailyAvailability` immediately.

---

### 2.5 Audit Trail & System Activity Monitoring
1. Navigate to `/admin/audit-logs`.
2. Inspect chronological immutable audit records:
   - **Actor:** User ID, role, and username.
   - **Action:** e.g. `listing.approved`, `booking.payment_verified`, `booking.cancelled`, `user.registered`.
   - **Target:** Associated entity ID and type.
   - **Metadata & IP:** Client IP, correlation request ID (`X-Request-Id`).
3. Audit records cannot be edited or deleted via the UI.
