const express = require('express');
const Stripe = require('stripe');
const admin = require('firebase-admin');
const { db } = require('../firebase');
const router = express.Router();

const STRIPE_SECRET_KEY = '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';
const STRIPE_WEBHOOK_SECRET = 'whsec_YY2fVNvjhZaEZ1V6UbEUQXISvkm34HYF';
const FRONTEND_URL = 'https://nuvexenterprise.com.br/';

const stripe = new Stripe(STRIPE_SECRET_KEY);

// Função para adicionar um atraso
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

router.get('/stripe-plans', async (req, res) => {
    try {
        const ADAMANTIUM_PRICE_ID = 'price_1RPtBGA2mta7c3mQOYn6EPuK';
        const ADAMANTIUM_PRODUCT_ID = 'prod_SKYHnsK6XDiX1Y';

        // Busca apenas o preço do plano Adamantium
        const price = await stripe.prices.retrieve(ADAMANTIUM_PRICE_ID);
        const product = await stripe.products.retrieve(ADAMANTIUM_PRODUCT_ID);

        const plan = {
            id: price.id,
            name: product.name || 'Adamantium',
            price: price.unit_amount,
            currency: price.currency || 'BRL',
            description: product.description || 'Plano Adamantium',
            benefits: product.metadata && product.metadata.benefits ? JSON.parse(product.metadata.benefits) : [],
            stripePriceId: price.id,
        };

        res.json([plan]); // Retorna array com apenas um plano
    } catch (error) {
        console.error('Erro ao buscar plano do Stripe:', error.message);
        res.status(500).json({ error: 'Erro ao listar plano do Stripe', details: error.message });
    }
});

router.post('/create-payment-method-session', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuário não encontrado' });

        let customerId = userDoc.data().stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: userDoc.data().email,
                metadata: { userId }, // Adiciona metadados para rastreamento
            });
            customerId = customer.id;
            await userRef.update({ stripeCustomerId: customerId });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'setup',
            customer: customerId,
            success_url: `${FRONTEND_URL}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/billing?cancel=true`,
            metadata: { userId },
        });

        res.json({ id: session.id });
    } catch (error) {
        console.error('Erro ao criar sessão de pagamento:', error.message);
        res.status(500).json({ error: 'Erro ao criar sessão', details: error.message });
    }
});

router.post('/create-checkout-session', async (req, res) => {
    try {
        const { userId, email, isAnnual, couponCode } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        let customerId = userDoc.data().stripeCustomerId;
        
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: email,
                metadata: { userId }
            });
            customerId = customer.id;
            await userRef.update({ stripeCustomerId: customerId });
        }

        const trialStart = new Date();
        const trialDays = userDoc.data().trialPeriod || 7;
        const trialEnd = new Date(trialStart);
        trialEnd.setDate(trialEnd.getDate() + trialDays);

        // Configuração base da sessão
        const sessionConfig = {
            customer: customerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            billing_address_collection: 'required',
            line_items: [{
                price_data: {
                    currency: 'brl',
                    product: 'prod_SKYHnsK6XDiX1Y',
                    unit_amount: isAnnual ? 23880 : 2990,
                    recurring: {
                        interval: isAnnual ? 'year' : 'month'
                    }
                },
                quantity: 1,
            }],
            subscription_data: {
                trial_period_days: trialDays,
                metadata: {
                    trialStart: trialStart.toISOString(),
                    trialEnd: trialEnd.toISOString()
                }
            },
            success_url: `${FRONTEND_URL}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/billing?canceled=true`,
            metadata: {
                userId,
                isAnnual: String(isAnnual),
                trialStart: trialStart.toISOString(),
                trialEnd: trialEnd.toISOString()
            }
        };

        // Adiciona cupom se fornecido
        if (couponCode) {
            try {
                // Verifica se o cupom existe
                const coupon = await stripe.coupons.retrieve(couponCode);
                if (coupon.valid) {
                    sessionConfig.discounts = [{
                        coupon: couponCode,
                    }];
                }
            } catch (error) {
                console.log('Cupom inválido:', error.message);
                // Continua sem aplicar o cupom se ele for inválido
            }
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        await userRef.update({
            trialStart: trialStart.toISOString(),
            trialEnd: trialEnd.toISOString(),
            planName: 'Adamantium',
            status: 'trial',
            planEndDate: trialEnd.toISOString()
        });

        res.json({ 
            sessionId: session.id
        });
        
    } catch (error) {
        console.error('Erro ao criar sessão:', error);
        res.status(500).json({ 
            error: 'Erro ao criar sessão de checkout',
            details: error.message 
        });
    }
});

router.post('/activate-plan', async (req, res) => {
    try {
        const { userId, isAnnual } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId é obrigatório' });
        }

        // IDs fixos dos planos
        const ADAMANTIUM_MENSAL = 'price_1RPtBGA2mta7c3mQOYn6EPuK';
        const ADAMANTIUM_ANUAL = 'price_1RPtBFA2mta7c3mQGi9wiktc'; 

        const planId = isAnnual ? ADAMANTIUM_ANUAL : ADAMANTIUM_MENSAL;

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const userData = userDoc.data();
        const customerId = userData.stripeCustomerId;
        const defaultPaymentMethod = userData.defaultPaymentMethod;

        if (!customerId) {
            return res.status(400).json({ error: 'Usuário não possui cliente Stripe associado' });
        }

        if (!defaultPaymentMethod) {
            return res.status(400).json({ error: 'Nenhum método de pagamento padrão definido. Cadastre um cartão primeiro.' });
        }

        // Cancela assinatura anterior se existir
        if (userData.stripeSubscriptionId) {
            await stripe.subscriptions.cancel(userData.stripeSubscriptionId);
        }

        // Cria nova assinatura usando método de pagamento padrão
        const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{
                price: planId // Usa o planId determinado acima
            }],
            default_payment_method: defaultPaymentMethod,
            payment_settings: {
                payment_method_types: ['card'],
                save_default_payment_method: 'on_subscription'
            },
            expand: ['latest_invoice.payment_intent'],
        });

        // Atualiza dados no Firestore
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (isAnnual ? 365 : 30));

        await userRef.update({
            planName: 'Adamantium',
            planStartDate: startDate.toISOString(),
            planEndDate: endDate.toISOString(),
            planDurationDays: isAnnual ? 365 : 30,
            status: 'active',
            stripeSubscriptionId: subscription.id,
            autoBilling: true,
            trialEnd: null,
            transactions: admin.firestore.FieldValue.arrayUnion({
                date: startDate.toISOString().split('T')[0],
                description: `Ativação Adamantium ${isAnnual ? 'Anual' : 'Mensal'}`,
                amount: isAnnual ? 'R$ 238,80' : 'R$ 29,90',
                status: 'Concluído',
            }),
        });

        res.json({ 
            success: true, 
            planName: 'Adamantium',
            subscriptionId: subscription.id
        });

    } catch (error) {
        console.error('Erro ao ativar plano:', error);
        res.status(500).json({ 
            error: 'Erro ao ativar plano', 
            details: error.message 
        });
    }
});

async function checkTrialExpiration(userId) {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (userDoc.exists) {
        const data = userDoc.data();
        if (data.trialEnd && new Date() > new Date(data.trialEnd)) {
            await userRef.update({ status: 'expired' });
            console.log(`Trial expirado para userId: ${userId}`);
        }
    }
}

router.get('/check-trial', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
    await checkTrialExpiration(userId);
    res.sendStatus(200);
});

async function renewPlanAutomatically(userId) {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (userDoc.exists) {
        const data = userDoc.data();
        if (data.autoBilling && data.planEndDate && new Date() > new Date(data.planEndDate)) {
            const planId = data.planId || 'price_1RPOLWPFTVkGq67Ehen3VlPw';
            const customerId = data.stripeCustomerId;

            const price = await stripe.prices.retrieve(planId);
            if (price.type !== 'recurring') {
                console.error(`Erro: O plano ${planId} não é recorrente. Renovação automática cancelada para userId: ${userId}`);
                return;
            }

            const product = await stripe.products.retrieve(price.product);
            const subscription = await stripe.subscriptions.create({
                customer: customerId,
                items: [{ price: planId }],
                default_payment_method: data.defaultPaymentMethod,
            });

            const now = new Date();
            const planEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            await userRef.update({
                planStartDate: now.toISOString(),
                planEndDate: planEndDate.toISOString(),
                stripeSubscriptionId: subscription.id,
                transactions: admin.firestore.FieldValue.arrayUnion({
                    date: now.toISOString().split('T')[0],
                    description: `Renovação automática ${product.name}`,
                    amount: `R$ ${(price.unit_amount / 100).toFixed(2)}`,
                    status: 'Concluído',
                }),
            });
            console.log(`Plano renovado automaticamente para userId: ${userId}`);
        }
    }
}

router.get('/renew-plan-auto', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });
    await renewPlanAutomatically(userId);
    res.sendStatus(200);
});

router.post('/cancel-subscription', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId é obrigatório' });

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuário não encontrado' });

        const subscriptionId = userDoc.data().stripeSubscriptionId;
        if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId);

        await userRef.update({
            planName: null,
            planStartDate: null,
            planEndDate: null,
            status: 'inactive',
            stripeSubscriptionId: null,
            autoBilling: false,
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao cancelar assinatura:', error.message);
        res.status(500).json({ error: 'Erro ao cancelar assinatura' });
    }
});

router.post('/delete-payment-method', async (req, res) => {
    try {
        const { userId, paymentMethodId } = req.body;
        if (!userId || !paymentMethodId) return res.status(400).json({ error: 'userId e paymentMethodId são obrigatórios' });

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuário não encontrado' });

        await stripe.paymentMethods.detach(paymentMethodId);
        const paymentMethods = userDoc.data().paymentMethods.filter(pm => pm.stripePaymentMethodId !== paymentMethodId);
        await userRef.update({ paymentMethods });

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao deletar método de pagamento:', error.message);
        res.status(500).json({ error: 'Erro ao deletar método' });
    }
});

router.get('/check-payment-method-session', async (req, res) => {
    try {
        const { session_id } = req.query;
        if (!session_id) return res.status(400).json({ error: 'session_id é obrigatório' });

        const session = await stripe.checkout.sessions.retrieve(session_id);
        const userId = session.metadata.userId;

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ error: 'Usuário não encontrado' });

        const userData = userDoc.data();
        const customerId = userData.stripeCustomerId;
        if (!customerId) return res.status(400).json({ error: 'Nenhum cliente Stripe associado' });

        let paymentMethod;
        if (session.setup_intent) {
            const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent);
            if (!setupIntent.payment_method) {
                return res.status(400).json({ error: 'Nenhum método de pagamento associado ao setupIntent' });
            }
            paymentMethod = await stripe.paymentMethods.retrieve(setupIntent.payment_method);
            // Anexa o método de pagamento ao cliente se necessário
            try {
                if (paymentMethod.customer !== customerId) {
                    await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId });
                }
                // Define como método padrão no Stripe
                await stripe.customers.update(customerId, {
                    invoice_settings: { default_payment_method: paymentMethod.id },
                });
            } catch (error) {
                console.error('Erro ao anexar método de pagamento:', error);
                return res.status(500).json({ error: 'Erro ao processar método de pagamento' });
            }
        } else {
            // Busca o método de pagamento mais recente do cliente
            const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card',
                limit: 1,
            });
            if (!paymentMethods.data.length) {
                return res.status(400).json({ error: 'Nenhum método de pagamento encontrado' });
            }
            paymentMethod = paymentMethods.data[0];
        }

        const newPaymentMethod = {
            stripePaymentMethodId: paymentMethod.id,
            brand: paymentMethod.card.brand,
            cardNumber: paymentMethod.card.last4,
            expiryDate: `${paymentMethod.card.exp_month}/${paymentMethod.card.exp_year}`,
        };

        // Atualiza no Firestore SEM duplicar métodos
        try {
            let currentPaymentMethods = userData.paymentMethods || [];
            // Remove duplicatas do mesmo id
            currentPaymentMethods = currentPaymentMethods.filter(pm => pm.stripePaymentMethodId !== newPaymentMethod.stripePaymentMethodId);
            currentPaymentMethods.push(newPaymentMethod);

            await userRef.update({
                paymentMethods: currentPaymentMethods,
                defaultPaymentMethod: newPaymentMethod.stripePaymentMethodId,
            });
        } catch (error) {
            console.error('Erro ao atualizar Firestore:', error);
            return res.status(500).json({ error: 'Erro ao salvar método de pagamento' });
        }

        res.json({
            success: true,
            paymentMethod: newPaymentMethod,
            redirectTo: '/dashboard',
        });
    } catch (error) {
        console.error('Erro ao verificar sessão de pagamento:', error);
        res.status(500).json({ error: 'Erro ao verificar sessão', details: error.message });
    }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Erro ao verificar webhook:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            const userId = session.metadata.userId;
            if (session.mode === 'subscription') {
                const userRef = db.collection('users').doc(userId);
                const subscription = await stripe.subscriptions.retrieve(session.subscription);
                // Atualiza status do usuário para trial e salva as datas
                const trialStart = new Date(subscription.trial_start * 1000);
                const trialEnd = new Date(subscription.trial_end * 1000);

                await userRef.update({
                    stripeSubscriptionId: subscription.id,
                    planName: 'Adamantium',
                    status: 'trial',
                    trialStart: trialStart.toISOString(),
                    trialEnd: trialEnd.toISOString(),
                    planEndDate: trialEnd.toISOString(),
                    autoBilling: true
                });
            }
            break;

        case 'customer.subscription.trial_will_end':
            const subscription = event.data.object;
            const userRef = await db.collection('users')
                .where('stripeSubscriptionId', '==', subscription.id)
                .limit(1)
                .get();

            if (!userRef.empty) {
                const userDoc = userRef.docs[0];
                // Notificar usuário que o trial está acabando (você pode implementar sua lógica de notificação aqui)
            }
            break;

        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            if (invoice.billing_reason === 'subscription_cycle') {
                const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
                const userRef = db.collection('users')
                    .where('stripeSubscriptionId', '==', subscription.id)
                    .limit(1);
                const userSnap = await userRef.get();
                if (!userSnap.empty) {
                    const userDoc = userSnap.docs[0];
                    const now = new Date();
                    
                    await userDoc.ref.update({
                        status: 'active',
                        trialEnd: null,
                        planStartDate: new Date(subscription.current_period_start * 1000).toISOString(),
                        planEndDate: new Date(subscription.current_period_end * 1000).toISOString(),
                        transactions: admin.firestore.FieldValue.arrayUnion({
                            date: now.toISOString().split('T')[0],
                            description: `Assinatura Adamantium`,
                            amount: `R$ ${(invoice.amount_paid / 100).toFixed(2)}`,
                            status: 'Concluído',
                        }),
                    });
                }
            }
            break;

        // ...existing code for other events...

        res.json({ received: true });
    }
});

module.exports = router;