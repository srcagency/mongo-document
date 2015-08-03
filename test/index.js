'use strict';

var test = require('tape');
var assign = require('object-assign');
var Promise = require('bluebird');
var mongodb = Promise.promisifyAll(require('mongodb'));
var mongoDocument = require('../');

Promise.longStackTraces();

var db = mongodb.connectAsync('mongodb://localhost/mongo-document-tests');

var counter = 0;

function getModel() {
	function Person(){
		mongoDocument.init(this);
	}

	Person.fromJSON = function( json ){
		var p = new Person();
		return assign(p, json);
	};

	Person.prototype.toJSON = function(){
		return {
			pk: this.pk,
			name: this.name,
			age: this.age,
		};
	};

	mongoDocument.decorate(Person);

	Person.collection = db.call('collection', 'models_' + (counter++) + (new Date()).getTime().toString())
		.then(function(c){
			return c;
		});

	return Person;
}

test('init', function( t ){
	var wo = {};
	var wob = {};
	var w = { pk: true };

	mongoDocument.init(wo);
	mongoDocument.init(w);
	mongoDocument.init.call(wob);

	t.ok(wo.pk);
	t.ok(wob.pk);
	t.ok(w.pk);

	t.end();
});

test('statics', function( t ){
	var test = t.test;

	t.test('sort midifiers', function( t ){
		var Person = getModel();

		t.ok(typeof Person.sort === 'object', 'sort hash');

		var keys = Object.keys(Person.sort);

		t.ok(~keys.indexOf('ascending'), 'ascending presence');
		t.ok(~keys.indexOf('descending'), 'descending presence');
		t.end();
	});

	t.test('equal', function( t ){
		var Person = getModel();

		var a = new Person();
		var b = new Person();

		t.ok(Person.equal(a, a));
		t.ok(Person.equal(a, a, a));
		t.notOk(Person.equal(b, a));
		t.notOk(Person.equal(b, a, a));
		t.notOk(Person.equal(b, b, a));
		t.notOk(Person.equal(b, a, b));
		t.ok(Person.equal(b, b, b));

		t.end();
	});

	t.test('fromMongoJSON', function( t ){
		var Person = getModel();

		t.ok(typeof Person.fromMongoJSON === 'function', 'function presence');

		var person = Person.fromMongoJSON({
			_id: 'a',
			name: 'b',
		});

		t.equal(person.pk, 'a', 'pk property');
		t.equal(person.name, 'b', 'other property');

		t.end();
	});

	t.test('pkFromJson', function( t ){
		var Person = getModel();

		t.ok(Person.pkFromJSON('bad') === false, 'returns false on bad value');

		t.ok(Person.pkFromJSON('uuuuuuuuuuuu') === false, 'returns false on bad value');
		t.ok(Person.pkFromJSON('uuuuuuuuuuuuuuuuuuuuuuuu') === false, 'returns false on bad value');
		t.ok(Person.pkFromJSON('aaaaaaaaaaaa-aaaaaaaaaaaa') === false, 'returns false on bad value');

		var pk = Person.pkFromJSON('5433118c4c3fd89d6fe5d824');

		t.ok(pk instanceof mongodb.ObjectID, 'return an ObjectID');
		t.equal(pk.toString(), '5433118c4c3fd89d6fe5d824', 'the ObjectID holds correct value');

		t.end();
	});

	t.test('count', function( t ){
		t.plan(4);

		var Person = getModel();

		var initialCount = Person
			.count()
			.tap(function( count ){
				t.equal(typeof count, 'number', 'a number is returned');
				t.equal(parseInt(count, 10), count, 'the number is an integer');
				t.equal(count, 0, 'initial count');
			});

		var secondCount = initialCount
			.return(new Person())
			.call('save')
			.then(function(){
				return Person.count();
			});

		secondCount
			.tap(function( secondCount ){
				t.equal(secondCount, 1, 'count has increased');
			});
	});

	t.test('findOne', function( t ){
		t.plan(4);

		var Person = getModel();

		var adam = new Person();
		adam.name = 'Adam';
		adam.age = 33;

		var adamSaved = adam.save();

		adamSaved
			.then(function( adam ){
				return Person.findOne({ name: adam.name });
			})
			.tap(function( found ){
				t.equal(found.pk.toString(), adam.pk.toString(), 'one model is retrieved');
			});

		var eve = new Person();
		eve.name = 'Eve';
		eve.age = 33;

		var eveSaved = eve.save();

		Promise
			.join(adamSaved, eveSaved)
			.then(function(){
				return Person.findOne({ name: eve.name });
			})
			.tap(function( found ){
				t.equal(found.pk.toString(), eve.pk.toString(), 'the correct model is retrieved');
			});

		Promise
			.join(eveSaved, adamSaved)
			.then(function(){
				return Person.findOne({ age: 33 });
			})
			.tap(function( found ){
				t.equal(found.pk.toString(), adam.pk.toString(), 'the correct model is retrieved');
			});

		Person.findOne({ age: 'bad' })
			.then(function( r ){
				t.equal(r, null, 'null is returned when no matching record is found')
			});
	});

	t.test('findOneByPk', function( t ){
		t.plan(2);

		var Person = getModel();

		var person = new Person();

		var saved = person
			.save()
			.then(function(){
				return Person.findOneByPk(person.pk);
			})
			.then(function( found ){
				t.equal(person.pk.toString(), found.pk.toString(), 'found the saved model');
			});

		Person.findOneByPk('bad')
			.then(function( r ){
				t.equal(r, null, 'null is returned when no matching record is found')
			});
	});

	t.test('findAll (cursor)', function( t ){
		t.plan(5);

		var cursor = getModel()
			.findAll();

		t.ok(cursor.sort, 'sort');
		t.ok(cursor.limit, 'limit');
		t.ok(cursor.skip, 'skip');
		t.ok(cursor.toArray, 'toArray');
		t.ok(cursor.count, 'count');
	});

	t.test('findAll (and alias find)', function( t ){
		var Person = getModel();

		var a = new Person();
		a.name = 'Adam';
		a.age = 33;

		var b = new Person();
		b.name = 'Eve';
		b.age = 33;

		var c = new Person();
		c.age = 8

		var saved = Promise
			.map([ a, b, c ], Person.save);

		t.test(function( t ){
			t.plan(9);

			t.equal(Person.findAll, Person.find, 'find alias');

			saved
				.then(function(){
					return Person.findAll({ age: 33 }).toArray();
				})
				.then(function( found ){
					t.equal(found.length, 2, 'found two models');

					t.ok(found[0].equals(a) || found[1].equals(a), 'found first model');
					t.ok(found[0].equals(b) || found[1].equals(b), 'found second model');
				});

			saved
				.then(function(){
					return Person.findAll({ age: 33 }).sort({ name: Person.sort.ascending }).toArray();
				})
				.then(function( found ){
					t.equal(found[0].name, 'Adam', 'Adam first');
					t.equal(found[1].name, 'Eve', 'Eve last');
				});

			saved
				.then(function(){
					return Person.findAll({ age: 33 }).sort({ name: Person.sort.descending }).toArray();
				})
				.then(function( found ){
					t.equal(found[0].name, 'Eve', 'Eve first');
					t.equal(found[1].name, 'Adam', 'Adam last');
				});

			saved
				.then(function(){
					return Person.findAll({ name: 'Sam' }).toArray();
				})
				.then(function( found ){
					t.equal(found.length, 0, 'empty array');
				});
		});


		t.test('count', function( t ){
			t.plan(2);

			var count = saved
				.then(function(){
					return Person.findAll().count();
				})
				.then(function( count ){
					t.equals(count, 3, 'count');
				});

			var person = count
				.then(function(){
					return new Person().save();
				});

			Promise
				.join(count, person)
				.spread(function(){
					return Person.findAll().count();
				})
				.then(function( count ){
					t.equals(count, 4, 'count');
				});
		});

		t.end();
	});

	t.test('findAllByPk (and alias findByPk)', function( t ){
		t.plan(8);

		var Person = getModel();

		t.equal(Person.findAllByPk, Person.findByPk, 'findByPk alias');

		var a = new Person();
		a.age = 2;

		var b = new Person();
		b.age = 3;

		var c = new Person();
		c.age = 1;

		var d = new Person();	// not saved

		var saved = Promise
			.map([ a, b, c ], Person.save);

		saved
			.then(function(){
				return Person.findAllByPk([ a.pk, c.pk, d.pk ]).toArray();
			})
			.then(function( found ){
				t.equal(found.length, 2, 'found two models');

				t.ok(found[0].equals(a) || found[1].equals(a), 'found first model');
				t.ok(found[0].equals(c) || found[1].equals(c), 'found second model');
			});

		saved
			.then(function(){
				return Person.findAllByPk([ a.pk, b.pk, c.pk ]).sort({ age: Person.sort.ascending }).toArray();
			})
			.then(function( found ){
				t.ok(found[0].age < found[1].age, 'youngest first');
				t.ok(found[1].age < found[2].age, 'oldest last');
			});

		saved
			.then(function(){
				return Person.findAllByPk([ a.pk, b.pk, c.pk ]).sort({ age: Person.sort.descending }).toArray();
			})
			.then(function( found ){
				t.ok(found[0].age > found[1].age, 'oldest first');
				t.ok(found[1].age > found[2].age, 'youngest last');
			});
	});

	t.test('remove', function( t ){
		t.plan(2);

		var Person = getModel();

		var people = [
			Person.fromJSON({ age: 22, name: 'Brian' }),
			Person.fromJSON({ age: 35, name: 'Aron' }),
			Person.fromJSON({ age: 22, name: 'Carl' }),
		];

		var saved = Promise.map(people, Person.save);

		var removed = saved.then(function(){
			return Person.remove({ age: 22 });
		})
		.tap(function( count ){
			t.equal(count, 2, 'removed count');
		});

		removed
			.then(function(){
				return Person.count();
			})
			.tap(function( count ){
				t.equal(count, 1, 'count after remove');
			});
	});

	t.test('save', function( t ){
		t.plan(2);

		var Person = getModel();

		var person = new Person();
		person.name = 'Adam';

		var saved = Person.save(person)
			.tap(function( person ){
				t.ok(person.name, 'instance is returned on save');
			});

		var found = saved
			.then(function(){
				return Person.findOneByPk(person.pk);
			});

		Promise
			.join(found, person)
			.spread(function( found, current ){
				t.ok(found, 'model can be retrieved');
			});
	});

	t.test('update', function( t ){
		t.plan(1);

		var Person = getModel();

		var a = new Person();
		a.name = 'Eve';
		a.age = 22;

		var b = new Person();
		b.name = 'Adam';
		b.age = 22;

		var saved = Promise.join(a.save(), b.save());

		var update = saved
			.then(function(){
				return Person.update({ age: 22 }, { $inc: { age: 1 } });
			});

		update
			.then(function(){
				return Person.findAll().toArray();
			})
			.then(function( people ){
				t.ok(people.every(function( p ){ return p.age === 23; }), 'age is updated');
			});
	});

	t.test('fupsert', function( t ){
		t.plan(6);

		var Person = getModel();

		var a = new Person();
		a.name = 'Eve';
		a.age = 12;

		var saved = a.save();

		var update = saved
			.then(function(){
				return Person.fupsert({ name: 'Eve' }, { $set: { age: 10 } });
			})
			.tap(function( eve ){
				t.ok(eve.equals(a), 'fupsert update returned model');
			});

		update
			.then(function(){
				return Person.findOneByPk(a.pk);
			})
			.tap(function( eve ){
				t.equal(eve.age, 10, 'updated age');
			});

		var insert = saved
			.then(function(){
				return Person.fupsert({ name: 'James' }, { $set: { age: 55 } });
			})
			.tap(function( james ){
				t.equal(james.name, 'James', 'insert returned model name');
				t.equal(james.age, 55, 'insert returned model age');
			});

		insert
			.then(function(){
				return Person.findOne({ name: 'James' });
			})
			.tap(function( james ){
				t.equal(james.name, 'James', 'inserted name');
				t.equal(james.age, 55, 'inserted age');
			});
	});

	t.test('findAndModify', function( t ){
		t.plan(2);

		var Person = getModel();

		var a = new Person();
		a.name = 'Eve';
		a.age = 12;

		var saved = a.save();

		var update = saved
			.then(function(){
				return Person.findAndModify({ name: 'Eve' }, { $set: { age: 10 } });
			})
			.tap(function( eve ){
				t.ok(eve.equals(a), 'update returned model');
			});

		update
			.then(function(){
				return Person.findOneByPk(a.pk);
			})
			.tap(function( eve ){
				t.equal(eve.age, 10, 'updated age');
			});
	});
});

test('methods', function( t ){
	var test = t.test;

	t.test('equals', function( t ){
		t.plan(5);

		var Person = getModel();
		var Car = getModel();

		var a = new Person();
		var b = new Person();

		t.notOk(a.equals(b) || b.equals(a));
		t.ok(a.equals(a) && b.equals(b));

		var c = new Car();
		c.pk = a.pk;

		t.notOk(c.equals(a) || a.equals(c));

		var saved = Promise.join(a.save(), b.save());

		var aFromDb = saved.then(function(){
			return Person.findOneByPk(a.pk);
		})
			.tap(function( aFromDb ){
				t.ok(aFromDb.equals(a) && a.equals(aFromDb));
				t.notOk(aFromDb.equals(c) || c.equals(aFromDb));
			});
	});

	t.test('save (insert)', function( t ){
		t.plan(3);

		var Person = getModel();

		var person = new Person();
		person.name = 'Eve';

		var saved = person
			.save()
			.tap(function( person ){
				t.ok(person.name, 'instance is returned on save');
			});

		var found = saved
			.then(function(){
				return Person.findOneByPk(person.pk);
			});

		Promise
			.join(found, person)
			.spread(function( found, current ){
				t.ok(found, 'model can be retrieved');
				t.equal(found.name, person.name, 'name is stored correctly');
			});
	});

	t.test('save (update)', function( t ){
		t.plan(3);

		var Person = getModel();

		var person = new Person();
		person.name = 'Adam';

		var saved = person.save();

		var updated = saved
			.then(function(){
				person.name = 'Abel';
				return person.save();
			})
			.tap(function( person ){
				t.ok(person.name, 'instance is returned on save');
			});

		var found = updated
			.then(function(){
				return Person.findOneByPk(person.pk);
			});

		Promise
			.join(found, person)
			.spread(function( found, current ){
				t.equal(current.pk.toString(), found.pk.toString(), 'found the saved model');
				t.equal(found.name, current.name, 'the person has been updated');
			});
	});

	t.test('remove', function( t ){
		t.plan(3);

		var Person = getModel();

		var person = new Person();

		var saved = person.save();

		var removed = saved.call('remove')
			.tap(function( r ){
				t.ok(r.equals(person), 'returned object on remove');
			})

		var confirmedRemoved = removed
			.then(function(){
				return Person.findOneByPk(person.pk);
			})
			.tap(function( r ){
				t.equal(r, null);
			});

		var readded = confirmedRemoved
			.then(function(){
				return person.save();
			});

		readded
			.then(function(){
				return Person.findOneByPk(person.pk);
			})
			.tap(function( r ){
				t.ok(r.equals(person), 'returned result');
			});
	});
});

test('teardown', function( t ){
	db
		.call('dropDatabase')
		.return(db)
		.call('close');

	t.end();
});
