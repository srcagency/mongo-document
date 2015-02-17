'use strict';

var assign = require('object-assign');
var withoutKeys = require('without-keys');
var Promise = require('bluebird');
var mongodb = require('mongodb');
var renameKey = require('rename-key');
var debug = require('debug')('mongo-document');

module.exports = {
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
					ctor.indexesReady = ensureIndexes(ctor, options.indexes);
			},

			get: function(){
				return collection;
			},
		});

		assign(ctor, {
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
				debug('%s.remove %o with options %o', this.name, query, options);

				return this.collection.call('remove', prepareQuery(query), options);
			},

			update: function( query, object, options ){
				options = options || {};

				options.multi = options.multi !== false;

				debug('%s.update %o with options %o', this.name, query, options);

				return this.collection.call('update', prepareQuery(query), object, options);
			},

			count: function( query, options ){
				return this.collection.call('count', prepareQuery(query), options);
			},

			findOneByPk: function( pk ){
				debug('%s.findOneByPk pk: %s', this.name, pk);

				if (!pk)
					return Promise.resolve(null);

				return this.findOne({ pk: pk });
			},

			findOne: function( query ){

				debug('%s.findOne %o', this.name, query);

				return this.collection
					.call('findOne', prepareQuery(query))
					.bind(this)
					.then(this.fromMongoJSON);
			},

			// alias of findAll
			find: function(){
				return this.findAll.apply(this, arguments);
			},

			findAll: function( query, sort ){

				debug('%s.findAll %o with sort %o', this.name, query, sort);

				// @todo return cursor wrapper
				var cursor = this.collection.call('find', prepareQuery(query));

				sort && cursor.call('sort', prepareQuery(sort));

				return cursor
					.call('toArray')
					.bind(this)
					.map(this.fromMongoJSON);
			},

			fupsert: function( query, object, sort, options ){
				return this.findAndModify(query, sort, object, assign({
					upsert: true
				}, options));
			},

			findAndModify: function( query, sort, object, options ){
				if (options && options.new !== undefined)
					throw new Error('Setting the new attribute is not supported (it must be true)');

				options = assign(options || {}, { new: true });

				debug('%s.findAndModify %o with options %o and sort %o', this.name, query, options, sort);

				return this.collection
					.call('findAndModify', prepareQuery(query), prepareQuery(sort), object, options)
					.bind(this)
					.spread(this.fromMongoJSON);
			},
		});

		assign(ctor.prototype, {
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
			var keys = index.keys;
			var options = withoutKeys(index, [ 'keys' ]);

			return ctor.collection
				.call('ensureIndex', keys, options)
				.tap(function( r ){
					debug('%s added index %o with name %s', ctor.name, keys, r);
				})
				.return(index);
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

	return this.constructor.collection.call('insert', toMongoJSON(this), { safe: true });
}

function update(){
	debug('%s.save updating', this.constructor.name);

	var mongoJSON = toMongoJSON(this);
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
	return query && renameKey(query, 'pk', '_id');
}

function toMongoJSON( model ){
	return renameKey(model.toJSON('db'), 'pk', '_id');
}
