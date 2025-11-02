const { ApiData, sequelize } = require('./models');

(async () => {
    try {
        await sequelize.authenticate();
        console.log('\n✅ Connected to database\n');
        
        const data = await ApiData.findAll({
            order: [['createdAt', 'DESC']],
            limit: 100
        });
        
        console.log('=== Api_Data Table Records ===\n');
        
        if (data.length === 0) {
            console.log('❌ No records found in Api_Data table.\n');
            console.log('The table is empty or has not been created yet.');
        } else {
            console.log(`📊 Total records: ${data.length}\n`);
            
            data.forEach((record, index) => {
                console.log(`Record #${index + 1}:`);
                console.log(`  ID: ${record.id}`);
                console.log(`  Type: ${record.rtype || 'N/A'}`);
                console.log(`  UUID: ${record.uuid || 'N/A'}`);
                console.log(`  Search Word: ${record.searchWord || 'N/A'}`);
                console.log(`  ABN: ${record.abn || 'N/A'}`);
                console.log(`  ACN: ${record.acn || 'N/A'}`);
                console.log(`  Data: ${record.data ? JSON.stringify(record.data, null, 2) : 'N/A'}`);
                console.log(`  Created At: ${record.createdAt}`);
                console.log(`  Updated At: ${record.updatedAt}`);
                console.log('─'.repeat(50));
            });
        }
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.message.includes('does not exist')) {
            console.log('\n💡 The Api_Data table does not exist yet.');
            console.log('You may need to run migrations or sync the database.');
        }
        process.exit(1);
    }
})();

