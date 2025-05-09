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
    
    // Send "Open Manager" button
    await ctx.reply('Use the button below to open the manager:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Open Manager', callback_data: 'open_manager' }]
        ]
      }
    });
    
    // Get the most recent list
    const listsRef = collection(db, 'lists');
    const q = query(listsRef, orderBy('createdAt', 'desc'), limit(1));
    const recentListSnapshot = await getDocs(q);
    
    if (!recentListSnapshot.empty) {
      const listDoc = recentListSnapshot.docs[0];
      const listData = listDoc.data();
      const listDate = listData.date || new Date().toISOString().split('T')[0];
      const formattedDate = listDate.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3');
      
      // Send the most recent list button
      await ctx.reply(`📋 View List (${formattedDate})`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `View List (${formattedDate})`, callback_data: `view_list_${listDate}` }]
          ]
        }
      });
    }
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('Sorry, there was an error processing your request.');
  }
});

// Handle "Open Manager" button click
bot.action('open_manager', async (ctx) => {
  try {
    await ctx.answerCbQuery('Opening manager...');
    
    // Send subscription confirmation message
    await ctx.reply('📊 Domain List Manager', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'View Subscriptions', callback_data: 'view_subscriptions' }],
          [{ text: 'View Recent Lists', callback_data: 'view_recent_lists' }]
        ]
      }
    });
  } catch (error) {
    console.error('Error handling open_manager action:', error);
    await ctx.reply('Sorry, there was an error opening the manager.');
  }
});

// Handle "View Subscriptions" button click
bot.action('view_subscriptions', async (ctx) => {
  try {
    await ctx.answerCbQuery('Viewing subscriptions...');
    
    // Get user subscription info
    const userId = ctx.from.id;
    const userDoc = await getDoc(doc(db, 'subscribers', userId.toString()));
    
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const subscribedAt = userData.subscribedAt?.toDate() || new Date();
      const formattedDate = subscribedAt.toISOString().split('T')[0];
      
      await ctx.reply(`🔔 Subscription Information\n\nSubscribed since: ${formattedDate}\nStatus: Active`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Back to Manager', callback_data: 'open_manager' }]
          ]
        }
      });
    } else {
      await ctx.reply('You are not currently subscribed. Use /start to subscribe.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Subscribe Now', callback_data: 'subscribe_now' }]
          ]
        }
      });
    }
  } catch (error) {
    console.error('Error handling view_subscriptions action:', error);
    await ctx.reply('Sorry, there was an error viewing your subscriptions.');
  }
});

// Handle "Subscribe Now" button click
bot.action('subscribe_now', async (ctx) => {
  try {
    await ctx.answerCbQuery('Subscribing...');
    
    // Simulate /start command
    await ctx.reply('Starting subscription process...');
    await bot.handleUpdate({
      update_id: Date.now(),
      message: {
        message_id: Date.now(),
        from: ctx.from,
        chat: ctx.chat,
        date: Math.floor(Date.now() / 1000),
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    });
  } catch (error) {
    console.error('Error handling subscribe_now action:', error);
    await ctx.reply('Sorry, there was an error processing your subscription.');
  }
});

// Handle "View Recent Lists" button click
bot.action('view_recent_lists', async (ctx) => {
  try {
    await ctx.answerCbQuery('Loading recent lists...');
    
    // Get recent lists
    const listsRef = collection(db, 'lists');
    const q = query(listsRef, orderBy('createdAt', 'desc'), limit(5));
    const listsSnapshot = await getDocs(q);
    
    if (listsSnapshot.empty) {
      await ctx.reply('No recent lists found.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Back to Manager', callback_data: 'open_manager' }]
          ]
        }
      });
      return;
    }
    
    // Create buttons for each list
    const listButtons = listsSnapshot.docs.map(doc => {
      const listData = doc.data();
      const listDate = listData.date || new Date().toISOString().split('T')[0];
      const formattedDate = listDate.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3');
      return [{ text: `List (${formattedDate})`, callback_data: `view_list_${listDate}` }];
    });
    
    // Add back button
    listButtons.push([{ text: 'Back to Manager', callback_data: 'open_manager' }]);
    
    await ctx.reply('📋 Recent Lists:', {
      reply_markup: {
        inline_keyboard: listButtons
      }
    });
  } catch (error) {
    console.error('Error handling view_recent_lists action:', error);
    await ctx.reply('Sorry, there was an error loading recent lists.');
  }
});

// Handle callback for viewing lists
bot.action(/view_list_(.+)/, async (ctx) => {
  try {
    const date = ctx.match[1];
    await ctx.answerCbQuery(`Loading list for ${date}...`);
    
    // Get list data
    const listsRef = collection(db, 'lists');
    const q = query(listsRef, where('date', '==', date), limit(1));
    const listSnapshot = await getDocs(q);
    
    if (listSnapshot.empty) {
      await ctx.reply(`No list found for date: ${date}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Back to Recent Lists', callback_data: 'view_recent_lists' }]
          ]
        }
      });
      return;
    }
    
    const listDoc = listSnapshot.docs[0];
    const listData = listDoc.data();
    
    // Get items from the list
    const itemIds = listData.items || [];
    let itemsText = '';
    
    if (itemIds.length > 0) {
      // Get item details
      for (let i = 0; i < Math.min(itemIds.length, 10); i++) {
        const itemId = itemIds[i];
        const itemDoc = await getDoc(doc(db, 'items', itemId));
        
        if (itemDoc.exists()) {
          const itemData = itemDoc.data();
          itemsText += `• ${itemData.name || 'Unnamed item'}\n`;
        }
      }
      
      if (itemIds.length > 10) {
        itemsText += `\n... and ${itemIds.length - 10} more items`;
      }
    } else {
      itemsText = 'No items in this list.';
    }
    
    // Format date for display
    const formattedDate = date.replace(/(\d{4})-(\d{2})-(\d{2})/, '$1-$2-$3');
    
    await ctx.reply(`📋 List for ${formattedDate}\n\nItems: ${itemIds.length}\n\n${itemsText}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'View Full List on Website', url: `${process.env.FRONTEND_URL}?date=${date}` }],
          [{ text: 'Back to Recent Lists', callback_data: 'view_recent_lists' }]
        ]
      }
    });
  } catch (error) {
    console.error('Error in view_list action:', error);
    await ctx.reply('Sorry, there was an error loading the list.');
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
    
    for (const doc of subscribersSnapshot.docs) {
      const subscriber = doc.data();
      try {
        // Send "New list posted!" message with the NEW badge
        await bot.telegram.sendMessage(subscriber.userId, '🆕 New list posted!');
        
        // Send the button to view the list
        await bot.telegram.sendMessage(subscriber.userId, `📋 View List (${formattedDate})`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: `View List (${formattedDate})`, callback_data: `view_list_${listDate}` }]
            ]
          }
        });
        
        successCount++;
      } catch (error) {
        console.error(`Error sending notification to user ${subscriber.userId}:`, error);
        failCount++;
      }
    }
    
    console.log(`Notifications sent: ${successCount} success, ${failCount} failed`);
    return { 
      success: true, 
      message: `Notifications sent: ${successCount} success, ${failCount} failed` 
    };
  } catch (error) {
    console.error('Error sending notifications:', error);
    return { success: false, message: 'Error sending notifications' };
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
      message: 'Server error' 
    });
  }
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
