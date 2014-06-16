'use strict';

var extend = require('extend');
var Promise = require('bluebird');
var mongodb = require('poseidon-mongo');
var renameKey = require('rename-key');
var debug = require('debug')('mongo-document');

var mongoDocument = module.exports = {

	decorate: function( ctor, options ){
		debug('%s.decorate', ctor.name);

		var statics;
		var collection;

		options = options || {};

		ctor.addAttribute('pk');

		Object.defineProperty(ctor, 'collection', {

			set: function( value ){
				debug('%s setting collection', this.name);

				collection = Promise
					.cast(value)
					.bind(this)
					.tap(function( collection ){
						debug('%s collection %s.%s ready', this.name, collection.instance.db.databaseName, collection.instance.collectionName);
					});

				if (options.indexes)
					ensureIndexes.call(this, options.indexes);
			},

			get: function(){
				return collection;
			},

		});

		var oFindOneByPk = ctor.findOneByPk;

		extend(ctor, statics = {

			sort: {
				ascending: 1,
				descending: -1,
			},

			fromMongoJSON: function( json ){
				if (!json)
					return null;

				renameKey(json, '_id', 'pk');

				var model = this.fromJSON(json);

				model._mongoDocument_persisted = true;

				return model;
			},

			pkFromJSON: function( json ){
				try {
					return new mongodb.ObjectID.createFromHexString(json);
				} catch (e) {
				}

				return false;
			},

			remove: function( query, options, cb ){
				query && prepareQuery(query);

				debug('%s.remove %o with options %o', this.name, query, options);

				return ctor.collection
					.call('remove', query, options)
					.nodeify(typeof options === 'function' ? options : cb);
			},

			update: function( query, object, options, cb ){
				query && prepareQuery(query);
				options = options || {};

				if (typeof options.multi === 'undefined')
					options.multi = true;

				debug('%s.update %o with options %o', this.name, query, options);

				return ctor.collection
					.call('update', query, object, options)
					.nodeify(typeof options === 'function' ? options : cb);
			},

			count: function( query, options, cb ){
				query && prepareQuery(query);

				return ctor.collection
					.call('count', query, options)
					.nodeify(typeof options === 'function' ? options : cb);
			},

			findOneByPk: oFindOneByPk
				? function( pk ){
					debug('%s.findOneByPk delegating to original', this.name);
					return oFindOneByPk.call(this, pk) || findOneByPk.call(this, pk);
				}
				: findOneByPk,

			findOne: function( query ){
				query && prepareQuery(query);

				debug('%s.findOne %o', this.name, query);

				return ctor.collection
					.call('findOne', query)
					.bind(this)
					.then(statics.fromMongoJSON);
			},

			findAll: function( query, sort ){
				query && prepareQuery(query);
				sort && prepareQuery(sort);

				debug('%s.findAll %o with sort %o', this.name, query, sort);

				// @todo return cursor wrapper
				var cursor = ctor.collection
					.call('find', query);

				sort && cursor.call('sort', sort);

				return cursor
					.call('toArray')
					.bind(this)
					.map(statics.fromMongoJSON);
			},

			fupsert: function( query, object, sort, options ){
				return this.findAndModify(query, sort, object, extend(options || {}, { upsert: true }));
			},

			findAndModify: function( query, sort, object, options ){
				query && prepareQuery(query);
				sort && prepareQuery(sort);

				if (options && options.new !== undefined)
					throw new Error('Setting the new attribute is not supported (it must be true)');

				options = extend(options || {}, { new: true });

				debug('%s.findAndModify %o with options %o and sort %o', this.name, query, options, sort);

				return ctor.collection
					.call('findAndModify', query, sort, object, options)
					.bind(this)
					.spread(statics.fromMongoJSON);
			},

		});

		var oRemove = ctor.prototype.remove;

		extend(ctor.prototype, {

			remove: oRemove
				? function( cb ){
					return Promise
						.join(remove.call(this), oRemove.apply(this, arguments))
						.nodeify(cb);
				}
				: remove,

			save: function( cb ) {
				debug('%s.save running beforeSave', this.constructor.name);

				if (this.beforeSave && this.beforeSave() === false)
					return Promise.reject().nodeify(cb);

				// @todo allow for converters to customize the saved document
				var update = renameKey(extend({}, this.toJSON('db')), 'pk', '_id');
				var model = this;

				if (this._mongoDocument_persisted) {
					debug('%s.save doing update', this.constructor.name);
					delete update._id;

					return ctor.collection
						.call('update', { _id: this.pk }, { $set: update }, { upsert: true, safe: true })
						.then(function(){
							debug('updated');

							model._mongoDocument_persisted = true;
							model.afterSave && model.afterSave();
							return model;
						})
						.nodeify(cb);
				} else {
					debug('%s.save doing insert', this.constructor.name);
					return ctor.collection
						.call('insert', update, { safe: true })
						.then(function(){
							debug('inserted');

							model._mongoDocument_persisted = true;
							model.afterSave && model.afterSave();
							return model;
						})
						.nodeify(cb);
				}
			},

		});

	},

	init: function(){
		if (!this.pk)
			this.pk = mongodb.ObjectID();
	},

};

// static functions (called with ctor as context)

function ensureIndexes( indexes ){
	return indexes.map(function( index ){
		var options = extend({}, index);
		var keys = options.keys;
		delete options.keys;

		return this.collection
			.call('ensureIndex', keys, options)
			.then(function( r ){
				debug('%s added index %o with name %s', this.name, keys, r);
			});
	}, this);
};

function findOneByPk( pk ){
	debug('%s.findOneByPk pk: %s', this.name, pk);
	return pk && this.findOne({ _id: pk }) || Promise.resolve();
};

// methods (called with model instance as context)

function remove( cb ){
	this._mongoDocument_persisted = false;
	return this.constructor.remove({ pk: this.pk }, { single: true }, cb);
};

// helpers

function prepareQuery( query ){
	return renameKey(query, 'pk', '_id');
};