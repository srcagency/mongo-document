'use strict';

var extend = require('extend');
var Promise = require('bluebird');
var mongodb = require('mongodb');
var renameKey = require('rename-key');
var debug = require('debug')('mongo-document');

var mongoDocument = module.exports = {

	decorate: function( ctor, options ){
		debug('%s.decorate', ctor.name);

		var collection;

		options = options || {};

		// support https://github.com/srcagency/active-document
		if (ctor.addAttribute)
			ctor.addAttribute('pk');

		Object.defineProperty(ctor, 'collection', {
			writeable: false,
			enumerable: false,
			configurable: false,

			set: function( value ){
				debug('%s setting collection', ctor.name);

				collection = Promise
					.resolve(value)
					.tap(function( collection ){
						debug('%s collection %s.%s ready', ctor.name, collection.instance.db.databaseName, collection.instance.collectionName);
					});

				if (options.indexes)
					ensureIndexes(ctor, options.indexes);
			},

			get: function(){
				return collection;
			},
		});

		extend(ctor, {
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
				} catch (e) { }

				return false;
			},

			remove: function( query, options ){
				query && prepareQuery(query);

				debug('%s.remove %o with options %o', this.name, query, options);

				return this.collection.call('remove', query, options);
			},

			update: function( query, object, options ){
				query && prepareQuery(query);
				options = options || {};

				if (typeof options.multi === 'undefined')
					options.multi = true;

				debug('%s.update %o with options %o', this.name, query, options);

				return this.collection.call('update', query, object, options);
			},

			count: function( query, options ){
				query && prepareQuery(query);

				return this.collection.call('count', query, options);
			},

			findOneByPk: function( pk ){
				debug('%s.findOneByPk pk: %s', this.name, pk);

				return this.findOne({ pk: pk });
			},

			findOne: function( query ){
				query && prepareQuery(query);

				debug('%s.findOne %o', this.name, query);

				return this.collection
					.call('findOne', query)
					.bind(this)
					.then(this.fromMongoJSON);
			},

			// alias of findAll
			find: function(){
				return this.findAll.apply(this, arguments);
			},

			findAll: function( query, sort ){
				query && prepareQuery(query);
				sort && prepareQuery(sort);

				debug('%s.findAll %o with sort %o', this.name, query, sort);

				// @todo return cursor wrapper
				var cursor = this.collection.call('find', query);

				sort && cursor.call('sort', sort);

				return cursor
					.call('toArray')
					.bind(this)
					.map(this.fromMongoJSON);
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

				return this.collection
					.call('findAndModify', query, sort, object, options)
					.bind(this)
					.spread(this.fromMongoJSON);
			},
		});

		extend(ctor.prototype, {
			toMongoJSON: ctor.prototype.toMongoJSON || toMongoJSON,

			remove: remove,

			save: save,
		});
	},

	init: function( m ){
		init(m || this);
	},

};

// static functions (called with ctor as context)

function ensureIndexes( ctor, indexes ){
	return Promise
		.map(indexes, function( index ){
			var options = extend({}, index);
			var keys = options.keys;
			delete options.keys;

			return ctor.collection
				.call('ensureIndex', keys, options)
				.then(function( r ){
					debug('%s added index %o with name %s', ctor.name, keys, r);
				});
		});
}

// methods (called with model instance as context)

function remove(){
	this._mongoDocument_persisted = false;
	return this.constructor.remove({ pk: this.pk }, { single: true });
};

function save(){
	debug('%s.save', this.constructor.name);

	return Promise
		.bind(this)
		.tap(this._mongoDocument_persisted ? update : insert)
		.tap(afterSave)
		.return(this);
}

function insert(){
	debug('%s.save inserting', this.constructor.name);

	return this.constructor.collection.call('insert', this.toMongoJSON(), { safe: true });
}

function update(){
	debug('%s.save updating', this.constructor.name);

	var mongoJSON = this.toMongoJSON();
	delete mongoJSON._id;

	return this.constructor.collection.call('update', { _id: this.pk }, { $set: mongoJSON }, { upsert: true, safe: true });
}

function afterSave(){
	debug('%s.save saved', this.constructor.name);

	this._mongoDocument_persisted = true;
}

// helpers

function init( model ){
	if (!model.pk)
		model.pk = mongodb.ObjectID();
}

function prepareQuery( query ){
	return renameKey(query, 'pk', '_id');
}

function toMongoJSON(){
	return renameKey(this.toJSON('db'), 'pk', '_id');
}
