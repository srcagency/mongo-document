'use strict';

var debug = require('debug')('mongo-document:Cursor');

module.exports = Cursor;

function Cursor( ctor, cursor ){
	this.ctor = ctor;
	this.cursor = cursor;
}

Cursor.prototype.descending = -1;
Cursor.prototype.ascending = 1;

Cursor.prototype.toArray = function(){
	return this
		.cursor
		.call('toArrayAsync')
		.bind(this.ctor)
		.map(this.ctor.fromMongoJSON);
}

Cursor.prototype.limit = function( limit ){
	debug('limit set to %s', limit);

	this.cursor = this
		.cursor
		.call('limit', limit);

	return this;
}

Cursor.prototype.skip = function( skip ){
	debug('skip set to %s', skip);

	this.cursor = this
		.cursor
		.call('skip', skip);

	return this;
}

Cursor.prototype.sort = function( sort ){
	debug('sort set to %o', sort);

	this.cursor = this
		.cursor
		.call('sort', Cursor.prepareQuery(sort));

	return this;
}

Cursor.prototype.count = function(){
	debug('count');

	return this
		.cursor
		.call('countAsync');
}
