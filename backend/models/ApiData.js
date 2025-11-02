const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const ApiData = sequelize.define('ApiData', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        field: 'id'
    },
    rtype: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'rtype'
    },
    uuid: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'uuid'
    },
    searchWord: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: 'search_word'
    },
    abn: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'abn'
    },
    acn: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'acn'
    },
    rdata: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'rdata'
    }, 
    alert: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'alert'
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'created_at'
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'updated_at'
    }
}, {
    tableName: 'api_data',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
        { fields: ['rtype'] },
        { fields: ['uuid'] },
        { fields: ['abn'] },
        { fields: ['acn'] }
    ]
});

module.exports = ApiData;

