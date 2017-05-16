const mongodb = require('mongodb');
const uuid = require('uuid/v4');
const validateUuid = require('uuid-validate');

const ObjectID = mongodb.ObjectID;
const parambulator = require('parambulator');

const fixObject = require('../message-utils').fixObject;

function sendErrorStatus(m, status, msg = '') {
  //    console.log('Sending error status '' + status + '': ', msg);

  m.response$.status(status).send({
    message: msg
  });
}

const errors = {
  invalid: {
    status: 400,
    message: 'Invalid data'
  },
  unknownid: {
    status: 404,
    message: 'Invalid ID'
  }
};

function checkError(m, res) {
  if (res && res.err$) {
    const details = errors[res.err$];
    if (details) sendErrorStatus(m, details.status, details.message);
    else sendErrorStatus(m, 500);
    return true;
  }
  return false;
}

module.exports = function(liveClients) {
  this.add('role:web, domain:entity, cmd:createTestData', (m, r) => {
    console.log('proxy creating test data');

    this.act(
      {
        role: 'testing',
        domain: 'entity',
        cmd: 'createTestData',
        count: m.args.query.count
      },
      r
    );
  });

  const sortOptionsChecker = parambulator({
    required$: ['desc', 'selector'],
    // isExpanded doesn't make any sense with sort, but the grid seems
    // to include it occasionally - probably a bug
    only$: ['desc', 'selector', 'isExpanded'],
    desc: {
      type$: 'boolean'
    },
    selector: {
      type$: 'string'
    }
  });

  const groupOptionsChecker = parambulator({
    required$: ['selector'],
    only$: ['desc', 'selector', 'isExpanded', 'groupInterval'],
    desc: {
      type$: 'boolean'
    },
    isExpanded: {
      type$: 'boolean'
    },
    selector: {
      type$: 'string'
    },
    groupInterval: {
      type$: ['string', 'integer']
      // unclear whether parambulator supports a spec that says 'can be enum but also number'
      //enum$: [ 'year', 'quarter', 'month', 'day', 'dayOfWeek', 'hour', 'minute', 'second' ] // and numbers?
    }
  });

  const summaryOptionsChecker = parambulator({
    required$: ['summaryType'],
    only$: ['summaryType', 'selector'],
    summaryType: {
      enum$: ['sum', 'avg', 'min', 'max', 'count']
    },
    selector: {
      type$: 'string'
    }
  });

  function validateAll(list, checker, short = true) {
    return list.reduce(
      (r, v) => {
        if (short && !r.valid) return r; // short circuiting
        const newr = checker.validate(v);
        if (newr) {
          r.errors.push(newr);
          r.valid = false;
        }
        return r;
      },
      { valid: true, errors: [] }
    );
  }

  function listValues(seneca, m, outgoing, r) {
    let p = {};

    if (m.args.query.take) {
      const take = parseInt(m.args.query.take);
      if (take > 0) p.take = take;
      else this.log.info('Invalid take parameter found', m.args.query.take);
    }

    if (m.args.query.skip) {
      const skip = parseInt(m.args.query.skip);
      if (skip >= 0) p.skip = skip;
      else this.log.info('Invalid skip parameter found', m.args.query.skip);
    }

    p.requireTotalCount = m.args.query.requireTotalCount === 'true';

    if (m.args.query.sort) {
      const sortOptions = JSON.parse(m.args.query.sort);

      if (sortOptions instanceof Array && sortOptions.length > 0) {
        const vr = validateAll(sortOptions, sortOptionsChecker);
        if (vr.valid) p.sort = sortOptions;
        else this.log.info('Sort parameter validation errors', vr.errors);
      } else this.log.info('Invalid sort parameter found', m.args.query.sort);
    }

    if (m.args.query.group) {
      const groupOptions = JSON.parse(m.args.query.group);

      if (groupOptions instanceof Array) {
        if (groupOptions.length > 0) {
          const vr = validateAll(groupOptions, groupOptionsChecker);
          if (vr.valid) {
            p.group = groupOptions;

            p.requireGroupCount = m.args.query.requireGroupCount === 'true';

            if (m.args.query.groupSummary) {
              const gsOptions = JSON.parse(m.args.query.groupSummary);

              if (gsOptions instanceof Array) {
                if (gsOptions.length > 0) {
                  const vr = validateAll(gsOptions, summaryOptionsChecker);
                  if (vr.valid) p.groupSummary = gsOptions;
                  else
                    this.log.info(
                      'groupSummary parameter validation errors',
                      vr.errors
                    );
                }
                // else - ignore empty array
              } else
                this.log.info(
                  'Invalid groupSummary parameter found',
                  m.args.query.groupSummary
                );
            }
          } else this.log.info('Group parameter validation errors', vr.errors);
        }
        // else - ignore empty array
      } else this.log.info('Invalid group parameter found', m.args.query.group);
    }

    if (m.args.query.totalSummary) {
      const tsOptions = JSON.parse(m.args.query.totalSummary);

      if (tsOptions instanceof Array) {
        if (tsOptions.length > 0) {
          const vr = validateAll(tsOptions, summaryOptionsChecker);
          if (vr.valid) p.totalSummary = tsOptions;
          else
            this.log.info(
              'totalSummary parameter validation errors',
              vr.errors
            );
        }
        // else - ignore empty array
      } else
        this.log.info(
          'Invalid totalSummary parameter found',
          m.args.query.totalSummary
        );
    }

    if (m.args.query.filter) {
      // keeping validation basic here - the structure is probably
      // an array of elements and nested arrays
      // the query service uses it if it can and returns errors
      // otherwise
      const filterOptions = JSON.parse(m.args.query.filter);
      if (typeof filterOptions === 'string' || filterOptions.length) {
        p.filter = filterOptions;
      } else
        this.log.info('Invalid filter parameter found', m.args.query.filter);
    }

    if (
      m.args.query.searchExpr &&
      m.args.query.searchOperation &&
      m.args.query.searchValue
    ) {
      const searchValue = JSON.parse(m.args.query.searchValue);
      const searchOperation = JSON.parse(m.args.query.searchOperation);
      const searchExpr = JSON.parse(m.args.query.searchExpr);
      if (
        typeof searchValue === 'string' &&
        typeof searchValue === 'string' &&
        (typeof searchExpr === 'string' || searchExpr.length)
      ) {
        p.searchValue = searchValue;
        p.searchOperation = searchOperation;
        p.searchExpr = searchExpr;
      }
    }

    if (m.args.query.select) {
      const selectOptions = JSON.parse(m.args.query.select);
      if (typeof selectOptions === 'string') p.select = [selectOptions];
      else if (selectOptions.length > 0) {
        if (selectOptions.reduce((r, v) => r && typeof v === 'string', true))
          p.select = selectOptions;
        else
          this.log.info(
            'Array-like select parameter found with invalid content'
          );
      } else this.log.info('Unknown type for select parameter');
    }

    outgoing.params = p;

    let liveId;

    if (m.args.query.live === 'true') {
      const notifyForAnyChange = m.args.query.notifyForAnyChange === 'true';

      if (notifyForAnyChange || m.args.query.aggregateName) {
        liveId = uuid();
        let idFieldName = '_id';
        if (m.args.query.idFieldName) {
          idFieldName = m.args.query.idFieldName;
        }

        seneca.act(
          {
            role: 'querychanges',
            cmd: 'register',
            id: liveId,
            idFieldName,
            aggregateName: m.args.query.aggregateName,
            notifyForAnyChange,
            queryMessage: outgoing
          },
          (err, res) => {
            if (res.registered) {
              liveClients.register(liveId);
            } else {
              console.error(`Failed to register live query ${liveId}`);
            }
          }
        );
      }
    }

    seneca.act(outgoing, (err, res) => {
      if (liveId) res.liveId = liveId;
      r(err, res);
    });
  }

  this.add('role:web, domain:entity, cmd:list', function(m, r) {
    listValues(
      this,
      m,
      {
        role: 'entitiesQuery',
        domain: 'entity',
        cmd: 'list'
      },
      r
    );
  });

  this.add('role:web, domain:entity, cmd:create', function(m, r) {
    const seneca = this;
    const instance = m.args.body;

    // not fixing object - we'll just pass it on
    seneca.act(
      {
        role: 'validation',
        domain: 'entity',
        cmd: 'validateOne',
        instance: instance
      },
      (err, res) => {
        if (err) r(err);
        else if (!res.valid) {
          sendErrorStatus(m, 400, res.err$);
          r();
        } else {
          instance.id = uuid();
          //console.log('Creating object with id: ' + instance.id);

          seneca.act({
            role: 'eventex',
            type: 'command',
            domain: 'entity',
            cmd: 'create',
            data: instance
          });

          m.response$.location('/data/v1/entity/' + instance.id);
          m.response$.sendStatus(201);
          r();
        }
      }
    );
  });

  function fetchValue(seneca, id, outgoing, r) {
    outgoing.id = id;
    return seneca.act(outgoing, r);
  }

  this.add('role:web, domain:entity, cmd:fetch', function(m, r) {
    const seneca = this;
    const id = m.args.params.id;

    if (!validateUuid(id, 4)) {
      sendErrorStatus(m, 404, 'Invalid ID');
      return r();
    }

    return fetchValue(
      seneca,
      id,
      {
        role: 'entitiesQuery',
        domain: 'entity',
        cmd: 'fetch'
      },
      function(err, res) {
        if (err) return r(err);
        if (checkError(m, res)) return r();

        m.response$.status(200).send(res);
        return r();
      }
    );
  });

  this.add('role:web, domain:entity, cmd:update', function(m, r) {
    const seneca = this;
    const id = m.args.params.id;

    if (!validateUuid(id, 4)) {
      sendErrorStatus(m, 404, 'Invalid ID');
      r();
    } else {
      const instance = fixObject(m.args.body);

      seneca.act(
        {
          role: 'validation',
          domain: 'entity',
          cmd: 'validateOne',
          instance,
          allowIncomplete: true
        },
        (err, res) => {
          if (err) r(err);
          else if (!res.valid) {
            sendErrorStatus(m, 400, res.err$);
            r();
          } else {
            instance.id = id;
            seneca.act({
              role: 'eventex',
              type: 'command',
              domain: 'entity',
              cmd: 'update',
              data: instance
            });
            m.response$.sendStatus(204);
            r();
          }
        }
      );
    }
  });

  this.add('role:web, domain:events, cmd:fetch', function(m, r) {
    const seneca = this;
    const id = m.args.params.id;

    if (!validateUuid(id, 4)) {
      sendErrorStatus(m, 404, 'Invalid ID');
      return r();
    }

    return fetchValue(
      seneca,
      id,
      {
        role: 'entitiesQuery',
        domain: 'events',
        cmd: 'fetch'
      },
      function(err, res) {
        if (err) return r(err);
        if (checkError(m, res)) return r();

        m.response$.status(200).send(res);
        return r();
      }
    );
  });

  this.add('role:web, domain:events, cmd:list', function(m, r) {
    listValues(
      this,
      m,
      {
        role: 'entitiesQuery',
        domain: 'events',
        cmd: 'list'
      },
      r
    );
  });
};
