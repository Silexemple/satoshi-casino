// api/deposit.js - Version DEBUG

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  console.log('=== DEPOSIT REQUEST ===');
  console.log('Method:', request.method);
  
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  try {
    // VÉRIFICATION VARIABLES
    const LNBITS_URL = process.env.LNBITS_URL?.trim().replace(/\/$/, '');
    const LNBITS_KEY = process.env.LNBITS_INVOICE_KEY?.trim();
    
    console.log('Env check:', {
      url: LNBITS_URL ? 'OK' : 'MISSING',
      key: LNBITS_KEY ? `OK (${LNBITS_KEY.substring(0, 5)}...)` : 'MISSING',
      keyLength: LNBITS_KEY?.length
    });

    if (!LNBITS_URL || !LNBITS_KEY) {
      return new Response(JSON.stringify({ 
        error: 'Config missing',
        details: { url: !!LNBITS_URL, key: !!LNBITS_KEY }
      }), { status: 500 });
    }

    // PARSING BODY
    const body = await request.json();
    console.log('Request body:', body);
    
    const amount = parseInt(body.amount);
    
    if (!amount || amount < 100) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), { status: 400 });
    }

    // PRÉPARATION PAYLOAD
    const payload = {
      out: false,
      amount: amount,
      memo: "Deposit Casino",
      expiry: 600
    };
    
    console.log('LNbits payload:', payload);

    // APPEL API AVEC DEBUG MAX
    const apiUrl = `${LNBITS_URL}/api/v1/payments`;
    console.log('Calling:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'X-Api-Key': LNBITS_KEY,
        'Content-type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('LNbits status:', response.status);
    console.log('LNbits headers:', Object.fromEntries(response.headers));

    // LECTURE ERREUR DÉTAILLÉE
    const responseText = await response.text();
    console.log('LNbits raw response:', responseText);

    if (!response.ok) {
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = { raw: responseText };
      }
      
      console.error('LNbits ERROR:', errorData);
      
      return new Response(JSON.stringify({
        error: 'LNbits API Error',
        status: response.status,
        lnbitsMessage: errorData.detail || errorData.message || responseText,
        hint: response.status === 401 ? 'Vérifie ta Invoice Key (pas Admin Key)' : 
              response.status === 404 ? 'URL LNbits invalide' :
              response.status === 400 ? 'Requête invalide - voir logs' : 'Erreur inconnue'
      }), { status: 502 });
    }

    // SUCCÈS
    const data = JSON.parse(responseText);
    console.log('Success:', data.payment_hash);
    
    return new Response(JSON.stringify({
      success: true,
      payment_request: data.payment_request,
      payment_hash: data.payment_hash,
      checking_id: data.checking_id
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('CRASH:', err);
    return new Response(JSON.stringify({ 
      error: 'Server crash',
      message: err.message,
      stack: err.stack 
    }), { status: 500 });
  }
}
