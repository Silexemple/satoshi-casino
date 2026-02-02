// api/deposit.js
// Crée une invoice Lightning pour le dépôt de sats

export const config = {
  runtime: 'edge', // Edge Runtime pour Vercel
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(request) {
  // Gestion CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }), 
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // 1. Récupération des variables d'environnement
    const LNBITS_URL = process.env.LNBITS_URL?.replace(/\/$/, ''); // Supprime le slash final si présent
    const LNBITS_INVOICE_KEY = process.env.LNBITS_INVOICE_KEY;
    const KV_REST_API_URL = process.env.KV_REST_API_URL;
    const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

    // Vérification des variables critiques
    if (!LNBITS_URL || !LNBITS_INVOICE_KEY) {
      console.error('Configuration manquante:', { 
        hasUrl: !!LNBITS_URL, 
        hasKey: !!LNBITS_INVOICE_KEY 
      });
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parsing du body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { amount, sessionId } = body;

    // 3. Validation des données
    if (!amount || typeof amount !== 'number') {
      return new Response(
        JSON.stringify({ error: 'Amount is required and must be a number' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (amount < 100 || amount > 10000) {
      return new Response(
        JSON.stringify({ error: 'Amount must be between 100 and 10000 sats' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Session ID is required' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Appel API LNbits pour créer l'invoice
    console.log(`Creating invoice for ${amount} sats, session: ${sessionId}`);
    
    const invoicePayload = {
      out: false,              // false = on reçoit de l'argent (invoice in)
      amount: Math.floor(amount), // Assure que c'est un entier
      memo: `Dépôt Satoshi Casino - ${sessionId.substring(0, 8)}`,
      expiry: 600,             // 10 minutes d'expiration
      webhook: `${process.env.VERCEL_URL || request.headers.get('host')}/api/webhook/lnbits`, // Optionnel: webhook pour notifications instantanées
    };

    const lnbitsResponse = await fetch(`${LNBITS_URL}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'X-Api-Key': LNBITS_INVOICE_KEY,
        'Content-type': 'application/json',
      },
      body: JSON.stringify(invoicePayload),
    });

    // 5. Gestion des erreurs LNbits
    if (!lnbitsResponse.ok) {
      let errorDetail;
      const errorText = await lnbitsResponse.text();
      
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.detail || errorJson.message || errorText;
      } catch {
        errorDetail = errorText || `HTTP ${lnbitsResponse.status}`;
      }

      console.error('LNbits API Error:', {
        status: lnbitsResponse.status,
        statusText: lnbitsResponse.statusText,
        detail: errorDetail,
        url: LNBITS_URL,
      });

      return new Response(
        JSON.stringify({ 
          error: 'Failed to create Lightning invoice', 
          detail: errorDetail,
          code: 'LNBITS_ERROR'
        }), 
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const invoiceData = await lnbitsResponse.json();
    console.log('Invoice created:', {
      hash: invoiceData.payment_hash,
      amount: amount,
      checkingId: invoiceData.checking_id,
    });

    // 6. Stockage dans Vercel KV (si disponible)
    if (KV_REST_API_URL && KV_REST_API_TOKEN) {
      try {
        const invoiceRecord = {
          sessionId: sessionId,
          amount: amount,
          paymentHash: invoiceData.payment_hash,
          checkingId: invoiceData.checking_id,
          createdAt: new Date().toISOString(),
          paid: false,
          paymentRequest: invoiceData.payment_request,
        };

        // Stocke l'invoice avec expiration de 10 minutes (600s)
        await fetch(`${KV_REST_API_URL}/set/invoice:${invoiceData.payment_hash}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${KV_REST_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            value: JSON.stringify(invoiceRecord),
            ex: 600,
          }),
        });
      } catch (kvError) {
        // Log mais ne bloque pas la réponse si KV échoue
        console.warn('KV storage failed (non-critical):', kvError);
      }
    }

    // 7. Réponse succès
    return new Response(
      JSON.stringify({
        success: true,
        payment_hash: invoiceData.payment_hash,
        payment_request: invoiceData.payment_request, // BOLT11 string à afficher/QR code
        checking_id: invoiceData.checking_id,
        amount: amount,
        expiry: 600,
        memo: invoicePayload.memo,
      }), 
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error in deposit.js:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
      }), 
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
