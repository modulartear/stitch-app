require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function test() {
    console.log('Testing Supabase Connection...');
    const { data: users, error: userError } = await supabase.from('users').select('id').limit(1);

    if (userError) {
        console.error('Error fetching users:', userError);
        return;
    }
    console.log('Users found:', users.length);

    if (users.length > 0) {
        const userId = users[0].id;
        console.log(`Attempting to insert test event for user ${userId}...`);
        const { data, error } = await supabase
            .from('events')
            .insert([{
                user_id: userId,
                name: 'Test Event',
                date: '2026-02-19',
                time: '12:00:00',
                category: 'wedding'
            }])
            .select();

        if (error) {
            console.error('Error inserting event:', error);
        } else {
            console.log('Event inserted successfully:', data);
            // Cleanup
            await supabase.from('events').delete().eq('id', data[0].id);
            console.log('Test event cleaned up.');
        }
    } else {
        console.log('No users found in DB to test with.');
    }
}

test();
