const { sequelize } = require('../config/db');
const User = require('./User');
const RefreshToken = require('./RefreshToken');
const PasswordResetToken = require('./PasswordResetToken');
const UserPaymentMethod = require('./UserPaymentMethod');
const Matter = require('./Matter');
const ApiData = require('./ApiData');

// Define associations
User.hasMany(UserPaymentMethod, { 
    foreignKey: 'user_id', 
    as: 'paymentMethods',
    onDelete: 'CASCADE'
});
UserPaymentMethod.belongsTo(User, { 
    foreignKey: 'user_id', 
    as: 'user' 
});

// Matter associations
User.hasMany(Matter, { foreignKey: 'user_id', as: 'matters', onDelete: 'CASCADE' });
Matter.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Export all models
module.exports = {
    sequelize,
    User,
    RefreshToken,
    PasswordResetToken,
    UserPaymentMethod,
    Matter,
    ApiData
};
