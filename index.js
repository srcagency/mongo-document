'use strict';

var assign = require('object-assign');
var withoutKeys = require('without-keys');
var Promise = require('bluebird');
var mongodb = require('mongodb');
var renameKey = require('rename-key');
var debug = require('debug')('mongo-document');

var bsonRegex = /^[0-9a-fA-F]{24}$/;
var Cursor = require('./Cursor');
Cursor.prepareQuery = prepareQuery;

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
					.then(function( collection ){
						debug('%s collection %s ready', ctor.name, collection.collectionName);

						return Promise.promisifyAll(collection);
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
				if (!json.match(bsonRegex))
					return false;

				return new mongodb.ObjectID.createFromHexString(json);
			},

			remove: function( query, options ){
				debug('%s.remove %o with options %o', this.name, query, options);

				return this.collection.call('deleteManyAsync', prepareQuery(query), options)
					.get('result')
					.get('n');
			},

			update: function( query, object, options ){
				debug('%s.update %o with options %o', this.name, query, options);

				return this.collection.call('updateManyAsync', prepareQuery(query), object, options);
			},

			count: function( query, options ){
				return this.collection.call('countAsync', prepareQuery(query), options);
			},

			findOneByPk: function( pk ){
				debug('%s.findOneByPk pk: %s', this.name, pk);

				if (!pk)
					return Promise.resolve(null);

				return this.findOne({ pk: pk });
			},

			findByPk: findAllByPk,
			findAllByPk: findAllByPk,

			findOne: function( query ){
				debug('%s.findOne %o', this.name, query);

				return this.collection.call('findOneAsync', prepareQuery(query))
					.bind(this)
					.then(this.fromMongoJSON);
			},

			find: findAll,
			findAll: findAll,

			fupsert: function( query, object, sort, options ){
				return this.findAndModify(query, object, sort, assign({
					upsert: true,
				}, options));
			},

			findAndModify: function( query, object, sort, options ){
				debug('%s.findAndModify %o with options %o and sort %o', this.name, query, options, sort);

				options = assign({
					sort: prepareQuery(sort),
					returnOriginal: false,
				}, options || {});

				return this.collection.call(
					'findOneAndUpdateAsync',
					prepareQuery(query),
					object,
					options
				)
					.bind(this)
					.get('value')
					.then(this.fromMongoJSON);
			},

			// delegators
			save: function( m ){
				return m.save();
			},

			equal: function(){
				for (var i = arguments.length - 1;i > 0;i--) {
					if (!equal(arguments[i], arguments[i - 1]))
						return false;
				}

				return true;
			},
		});

		assign(ctor.prototype, {
			remove: remove,

			equals: function( m ){
				return equal(this, m);
			},

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

			return ctor.collection.call('ensureIndexAsync', keys, options)
				.tap(function( r ){
					debug('%s added index %o with name %s', ctor.name, keys, r);
				})
				.return(index);
		});
}

function findAllByPk( pks ){
	if (!Array.isArray(pks))
		throw new Error('expected array of primary keys');

	return this.findAll({ pk: { $in: pks } });
}

function findAll( query ){
	debug('%s.findAll %o', this.name, query);

	return new Cursor(this, this.collection.call('findAsync', prepareQuery(query)));
}

// methods (called with model instance as context)

var updateOptions = { upsert: true };

function remove(){
	debug('%s.remove', this.constructor.name);

	this._mongoDocument_persisted = false;

	return this.constructor.collection.call('deleteOneAsync', { _id: this.pk })
		.return(this);
};

function save(){
	var action = this._mongoDocument_persisted ? update : insert;

	this._mongoDocument_persisted = true;

	return action(this.constructor, this, toMongoJSON(this))
		.return(this);
}

function insert( ctor, model, json ){
	debug('%s.save inserting', ctor.name);

	return ctor.collection.call('insertOneAsync', json);
}

function update( ctor, model, json ){
	debug('%s.save updating', ctor.name);
	delete json._id;

	return ctor.collection.call('updateOneAsync', { _id: model.pk }, { $set: json }, updateOptions);
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

function equal( a, b ){
	if (!b || !(a instanceof b.constructor))
		return false;

	if (a === b)
		return true;

	if (b.pk.equals)
		return b.pk.equals(a.pk);

	return b.pk === a.pk;
}
