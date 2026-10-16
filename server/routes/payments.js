const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../../config/firebase');

const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const paymongoAuth = Buffer.from(PAYMONGO_SECRET + ':').toString('base64');

// Create GCash payment link
router.post('/create-gcash', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Unauthorized' });
  const { orderId, amount, description } = req.body;
  if (!orderId || !amount) return res.status(400).json({ message: 'Missing orderId or amount' });

  try {
    console.log('PayMongo secret key present:', !!PAYMONGO_SECRET);
    console.log('Creating payment for orderId:', orderId, 'amount:', amount);
    // Create PayMongo payment link
    const response = await axios.post(
      'https://api.paymongo.com/v1/links',
      {
        data: {
          attributes: {
            amount: Math.round(amount * 100), // Convert to centavos
            description: description || 'The Fold Pizza Order #' + orderId.slice(0,8).toUpperCase(),
            remarks: 'Order ID: ' + orderId,
            redirect: {
              success: BASE_URL + '/payment-result?orderId=' + orderId,
              failed: BASE_URL + '/payment-result?orderId=' + orderId + '&status=failed',
            }
          }
        }
      },
      {
        headers: {
          'Authorization': 'Basic ' + paymongoAuth,
          'Content-Type': 'application/json',
        }
      }
    );

    const link = response.data.data;
    const checkoutUrl = link.attributes.checkout_url;
    const referenceNumber = link.attributes.reference_number;

    // Save payment reference to order
    await db.collection('orders').doc(orderId).update({
      paymentStatus: 'pending',
      paymongoRef: referenceNumber,
      paymongoLinkId: link.id,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, checkoutUrl, referenceNumber, linkId: link.id });
  } catch (err) {
    const errDetail = err.response?.data?.errors?.[0]?.detail || err.message;
    console.error('PayMongo error:', err.response?.data || err.message);
    console.error('PayMongo status:', err.response?.status);
    res.status(500).json({ success: false, message: errDetail });
  }
});

// Check payment status
router.get('/check/:orderId', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const orderDoc = await db.collection('orders').doc(req.params.orderId).get();
    if (!orderDoc.exists) return res.status(404).json({ message: 'Order not found' });
    const order = orderDoc.data();

    if (!order.paymongoLinkId) return res.json({ paymentStatus: 'no_payment' });

    // Check with PayMongo
    const response = await axios.get(
      `https://api.paymongo.com/v1/links/${order.paymongoLinkId}`,
      { headers: { 'Authorization': 'Basic ' + paymongoAuth } }
    );

    const linkStatus = response.data.data.attributes.status;
    const isPaid = linkStatus === 'paid';

    if (isPaid && order.paymentStatus !== 'paid') {
      // Update order as paid and confirmed
      await db.collection('orders').doc(req.params.orderId).update({
        paymentStatus: 'paid',
        status: 'confirmed',
        paidAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, paymentStatus: isPaid ? 'paid' : 'pending', linkStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PayMongo webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = JSON.parse(req.body);
    const eventType = event.data?.attributes?.type;

    if (eventType === 'link.payment.paid') {
      const remarks = event.data?.attributes?.data?.attributes?.remarks || '';
      const orderId = remarks.replace('Order ID: ', '').trim();
      if (orderId) {
        await db.collection('orders').doc(orderId).update({
          paymentStatus: 'paid',
          status: 'confirmed',
          paidAt: new Date().toISOString(),
        });
        console.log('✅ Payment confirmed for order:', orderId);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;