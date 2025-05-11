// bot-server/index.js
const { Telegraf } = require('telegraf');
const { initializeApp } = require('firebase/app');
const { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  query, 
  orderBy, 
  limit, 
  serverTimestamp 
} = require('firebase/firestore');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Initialize Telegram bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Debug function to log errors to chat
async function logErrorToChat(ctx, stage, error) {
  try {
    const errorMessage = `🐞 Debug [${stage}]:\n${error.message}\n\nStack: ${error.stack ? error.stack.substring(0, 200) + '...' : 'No stack trace'}`;
    await ctx.reply(errorMessage);
  } catch (logError) {
    console.error('Error logging to chat:', logError);
  }
}

// Start command
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  
  try {
    // Add user to subscribers collection
    await setDoc(doc(db, 'subscribers', userId.toString()), {
      userId: userId,
      username: username || '',
      firstName: ctx.from.first_name || '',
      lastName: ctx.from.last_name || '',
      subscribedAt: serverTimestamp()
    });
    
    // Send welcome message with checkmark emoji
    await ctx.reply('✅ You\'re subscribed! You\'ll be notified for new domain lists.');
    
    try {
      // Log the web app URL for debugging
      await ctx.reply(`🔍 Debug: Using web app URL: ${process.env.WEB_APP_URL || 'NOT SET!'}`);
      
      // Try sending a regular keyboard button first
      await ctx.reply('Attempting to send keyboard button...', {
        reply_markup: {
          keyboard: [
            [{ text: 'Test Regular Button' }]
          ],
          resize_keyboard: true
        }
      });
      
      // Now try the web_app button
      await ctx.reply('Use the button below to open the list manager:', {
        reply_markup: {
          keyboard: [
            [{ text: 'Open Manager', web_app: { url: process.env.WEB_APP_URL } }]
          ],
          resize_keyboard: true
        }
      });
      
      // Also try an inline button version
      await ctx.reply('Or use this inline button:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Open Manager (Inline)', web_app: { url: process.env.WEB_APP_URL } }]
          ]
        }
      });
      
    } catch (buttonError) {
      await logErrorToChat(ctx, 'BUTTON_CREATION', buttonError);
    }
    
    try {
      // Get the most recent list
      const listsRef = collection(db, 'lists');
      const q = query(listsRef, orderBy('createdAt', 'desc'), limit(1));
      const recentListSnapshot = await getDocs(q);
      
      if (!recentListSnapshot.empty) {
        const listDoc = recentListSnapshot.docs[0];
        const listData = listDoc.data();
        await ctx.reply(`📋 Found recent list: ${JSON.stringify(listData, null, 2).substring(0, 200)}`);
        
        const listDate = listData.date || new Date().toISOString().split('T')[0];
        const formattedDate = listDate.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3');
        
        // Send the most recent list button
        await ctx.reply(`📋 View List (${formattedDate})`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: `View List (${formattedDate})`, web_app: { url: `${process.env.WEB_APP_URL}?date=${listDate}` } }]
            ]
          }
        });
      } else {
        await ctx.reply('No recent lists found in the database.');
      }
    } catch (listError) {
      await logErrorToChat(ctx, 'RECENT_LIST', listError);
    }
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('Sorry, there was an error processing your request.');
    await logErrorToChat(ctx, 'START_COMMAND', error);
  }
});

// Function to send notifications to all subscribers
async function sendNotificationToAll(listDate) {
  try {
    // Get all subscribers
    const subscribersRef = collection(db, 'subscribers');
    const subscribersSnapshot = await getDocs(subscribersRef);
    
    if (subscribersSnapshot.empty) {
      console.log('No subscribers found');
      return { success: false, message: 'No subscribers found' };
    }
    
    // Format date for display
    const formattedDate = listDate.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3');
    
    // Send notification to each subscriber
    let successCount = 0;
    let failCount = 0;
    let errors = [];
    
    for (const doc of subscribersSnapshot.docs) {
      const subscriber = doc.data();
      try {
        // Send "New list posted!" message
        await bot.telegram.sendMessage(subscriber.userId, '🆕 New list posted!');
        
        // Then send button
        await bot.telegram.sendMessage(subscriber.userId, `📋 View List (${formattedDate})`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: `View List (${formattedDate})`, web_app: { url: `${process.env.WEB_APP_URL}?date=${listDate}` } }]
            ]
          }
        });
        
        successCount++;
      } catch (error) {
        console.error(`Error sending notification to user ${subscriber.userId}:`, error);
        errors.push(`User ${subscriber.userId}: ${error.message}`);
        failCount++;
        
        // Try to send error info to the user
        try {
          await bot.telegram.sendMessage(subscriber.userId, 
            `⚠️ Error sending notification: ${error.message.substring(0, 100)}`);
        } catch (logError) {
          console.error('Failed to send error log to user:', logError);
        }
      }
    }
    
    console.log(`Notifications sent: ${successCount} success, ${failCount} failed`);
    return { 
      success: true, 
      message: `Notifications sent: ${successCount} success, ${failCount} failed`,
      errors: errors
    };
  } catch (error) {
    console.error('Error sending notifications:', error);
    return { success: false, message: 'Error sending notifications', error: error.message };
  }
}

// Set up Express server
const expressApp = express();
const PORT = process.env.PORT || 3001;

// Middleware
expressApp.use(cors());
expressApp.use(express.json());

// Routes
expressApp.post('/notify', async (req, res) => {
  try {
    const { date } = req.body;
    
    if (!date) {
      return res.status(400).json({ 
        success: false, 
        message: 'Date is required' 
      });
    }
    
    const result = await sendNotificationToAll(date);
    return res.json(result);
  } catch (error) {
    console.error('Error in notify endpoint:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.message
    });
  }
});

// Debug endpoint
expressApp.get('/debug-env', (req, res) => {
  res.json({
    webAppUrl: process.env.WEB_APP_URL || 'NOT SET',
    botToken: process.env.BOT_TOKEN ? 'SET (hidden)' : 'NOT SET',
    firebaseConfigSet: !!firebaseConfig.apiKey
  });
});

// Health check endpoint
expressApp.get('/', (req, res) => {
  res.send('Bot server is running');
});

// Start Express server
expressApp.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Start the bot
bot.launch().then(() => {
  console.log('Bot started successfully');
}).catch((error) => {
  console.error('Error starting bot:', error);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
