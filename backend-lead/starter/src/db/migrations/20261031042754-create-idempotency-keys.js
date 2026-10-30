'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('idempotency_keys', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      scope: { type: Sequelize.STRING, allowNull: false },
      key: { type: Sequelize.STRING, allowNull: false },
      request_hash: { type: Sequelize.STRING, allowNull: false },
      response_status: { type: Sequelize.INTEGER, allowNull: true },
      response_body: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.addIndex('idempotency_keys', ['scope', 'key'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('idempotency_keys');
  },
};
