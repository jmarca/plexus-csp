'use strict';

var core     = require('./core');
var channels = require('./channels');


exports.timeout = function(ms) {
  var ch = channels.chan();
  var t = setTimeout(function() {
    clearTimeout(t);
    channels.close(ch);
  }, ms);
  return ch;
};


exports.ticker = function(ms) {
  var ch = channels.chan();
  var t;
  var step = function() {
    clearTimeout(t);
    t = setTimeout(step, ms);
    core.go(function*() {
      if (!(yield channels.push(ch, null)))
        clearTimeout(t);
    });
  };
  t = setTimeout(step, ms);
  return ch;
};


exports.each = function(fn, input) {
  return core.go(function*() {
    var val;
    while (undefined !== (val = yield channels.pull(input)))
      if (fn)
        yield fn(val);
  });
};


exports.pipe = function(input, output, keepOpen) {
  return core.go(function*() {
    var val;
    while (undefined !== (val = yield input.pull()))
      if (!(yield output.push(val)))
        break;
    if (!keepOpen) {
      input.close();
      output.close();
    }
  });
};


exports.createLock = function() {
  var _busy = channels.chan();
  _busy.push(null);

  return {
    acquire: function() { return _busy.pull(); },
    release: function() { return _busy.push(null); }
  };
};


exports.fromGenerator = function(gen) {
  var _closed = false;

  return {
    pull: function(client) {
      var handler = client || core.defer();
      var value = undefined;

      if (!_closed) {
        var step = gen.next();
        if (step.done)
          _closed = true;
        else
          value = step.value;
      }

      handler.resolve(value);
      return handler;
    },
    close: function() {
      _closed = true;
    }
  };
};


exports.fromStream = function(stream, closeStream)
{
  var output = channels.chan();
  var lock   = exports.createLock();

  stream.on('readable', function() {
    core.go(function*() {
      var chunk;

      yield lock.acquire();

      while (null !== (chunk = stream.read())) {
        if (!(yield output.push(chunk))) {
          closeStream && closeStream();
          break;
        }
      }

      lock.release();
    });
  });

  stream.on('end', function() {
    core.go(function*() {
      yield lock.acquire();
      output.close();
    });
  });

  stream.on('error', function(err) {
    throw new Error(err);
  });

  return output;
};
