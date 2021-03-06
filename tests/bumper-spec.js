'use strict'

const chai = require('chai')
const cpExec = require('child_process').exec
const __ = require('lodash')
const path = require('path')
const Promise = require('promise')
const rewire = require('rewire')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const expect = chai.expect
chai.use(sinonChai)

const pkgJson = require('../package.json')
const utils = require('../lib/utils')
const logger = require('../lib/logger')
const Bumper = rewire('../lib/bumper')

const exec = Promise.denodeify(cpExec)
const getVersionCmd = 'node -e "console.log(require(\'./_package.json\').version)"'

/**
 * Helper for performing repetative tasks in setting up _maybeBumpVersion tests
 * Since versiony doesn't let you tell it to be quiet, we need to stub out
 * console.log() but only while _maybeBumpVersion runs, or we won't get mocha output
 * while running our tests
 *
 * @param {Object} ctx - the context object so the function can pass some info back to the tests for validation
 * @param {String} scope - the scope to bump
 * @param {String} expectedVersion - the expected version after the bump
 */
function testMaybeBumpVersion (ctx, scope, expectedVersion) {
  describe(`a ${scope}`, function () {
    let bumper, logStub, info, newVersion
    beforeEach(function () {
      bumper = ctx.bumper

      logStub = sinon.stub(console, 'log')
      info = bumper._maybeBumpVersion({scope, modifiedFiles: []}, '_package.json')
      logStub.restore()

      return exec(`${getVersionCmd}`)
        .then((stdout) => {
          newVersion = stdout.replace('\n', '')
        })
    })

    it('should create the correct version', function () {
      expect(newVersion).to.be.equal(expectedVersion)
    })

    if (scope === 'none') {
      it('should not include the version', function () {
        expect(info.version).to.equal(undefined)
      })

      it('should not add "package.json" to the list of modified files', function () {
        expect(info.modifiedFiles).not.to.include('_package.json')
      })
    } else {
      it('should return the correct version', function () {
        expect(info.version).to.be.equal(expectedVersion)
      })

      it('should add "package.json" to the list of modified files', function () {
        expect(info.modifiedFiles).to.include('_package.json')
      })
    }
  })
}

describe('Bumper', function () {
  let bumper, sandbox
  let execStub, revertExecRewire
  let prependStub, revertPrepend
  let depStub, revertDeps
  let readFileStub, revertReadFileRewire
  let writeFileStub, revertWriteFileRewire

  beforeEach(function () {
    sandbox = sinon.sandbox.create()
    sandbox.stub(logger, 'log')
    sandbox.stub(logger, 'error')

    // stub out the top-level 'exec'
    execStub = sandbox.stub()
    revertExecRewire = Bumper.__set__('exec', execStub)

    // stub out the top-level 'prepend'
    prependStub = sandbox.stub()
    revertPrepend = Bumper.__set__('prepend', prependStub)

    // stub out dependency reporter
    depStub = {
      run: sandbox.stub().returns(Promise.resolve())
    }
    revertDeps = Bumper.__set__('dependencies', depStub)

    // stub out the top-level 'readFile'
    readFileStub = sandbox.stub()
    revertReadFileRewire = Bumper.__set__('readFile', readFileStub)

    // stub out the top-level 'writeFile'
    writeFileStub = sandbox.stub()
    revertWriteFileRewire = Bumper.__set__('writeFile', writeFileStub)

    bumper = new Bumper({
      ci: [],
      config: {},
      vcs: {}
    })
  })

  afterEach(function () {
    sandbox.restore()
    revertExecRewire()
    revertPrepend()
    revertDeps()
    revertReadFileRewire()
    revertWriteFileRewire()
  })

  describe('.check()', function () {
    beforeEach(function () {
      sandbox.stub(bumper, '_getOpenPrInfo').returns(Promise.resolve({scope: 'minor'}))
    })

    describe('when not a PR build', function () {
      beforeEach(function () {
        return bumper.check()
      })

      it('should notify user that it is skipping the check', function () {
        expect(logger.log).to.have.been.calledWith('Not a PR build, skipping check')
      })

      it('should not look for open pr info', function () {
        expect(bumper._getOpenPrInfo).to.have.callCount(0)
      })
    })

    describe('when it is a PR build', function () {
      beforeEach(function () {
        bumper.config.isPr = true
        return bumper.check()
      })

      it('should look for open pr info', function () {
        expect(bumper._getOpenPrInfo).to.have.callCount(1)
      })

      it('should notify user of the scope it found', function () {
        expect(logger.log).to.have.been.calledWith('Found a minor bump for the current PR')
      })
    })
  })

  describe('.checkCoverage()', function () {
    let result, error, errorMsg
    beforeEach(function () {
      result = error = null
      sandbox.stub(utils, 'maybePostComment').returns(Promise.resolve())
    })

    describe('when no baseline coverage', function () {
      beforeEach(function (done) {
        delete bumper.config.baselineCoverage
        const link = 'https://github.com/ciena-blueplanet/pr-bumper#code-coverage'
        errorMsg = `No baseline coverage info found!\nSee ${link} for configuration info.`
        bumper.checkCoverage()
          .then((resp) => {
            result = resp
          })
          .catch((err) => {
            error = err
          })

        setTimeout(() => {
          done()
        }, 0)
      })

      it('should not resolve', function () {
        expect(result).to.equal(null)
      })

      it('should maybe post a comment', function () {
        expect(utils.maybePostComment).to.have.been.calledWith(bumper.config, bumper.vcs, errorMsg, true)
      })

      it('should reject with an error', function () {
        expect(error).to.equal(errorMsg)
      })
    })

    describe('when baseline coverage is not a number', function () {
      beforeEach(function (done) {
        bumper.config.baselineCoverage = '85.93'
        const link = 'https://github.com/ciena-blueplanet/pr-bumper#code-coverage'
        errorMsg = `No baseline coverage info found!\nSee ${link} for configuration info.`

        bumper.checkCoverage()
          .then((resp) => {
            result = resp
          })
          .catch((err) => {
            error = err
          })

        setTimeout(() => {
          done()
        }, 0)
      })

      it('should not resolve', function () {
        expect(result).to.equal(null)
      })

      it('should maybe post a comment', function () {
        expect(utils.maybePostComment).to.have.been.calledWith(bumper.config, bumper.vcs, errorMsg, true)
      })

      it('should reject with an error', function () {
        expect(error).to.equal(errorMsg)
      })
    })

    describe('when no current coverage found', function () {
      beforeEach(function (done) {
        bumper.config.baselineCoverage = 85.93
        sandbox.stub(utils, 'getCurrentCoverage').returns(-1)
        const link = 'https://github.com/ciena-blueplanet/pr-bumper#code-coverage'
        errorMsg = `No current coverage info found!\nSee ${link} for configuration info.`

        bumper.checkCoverage()
          .then((resp) => {
            result = resp
          })
          .catch((err) => {
            error = err
          })

        setTimeout(() => {
          done()
        }, 0)
      })

      it('should not resolve', function () {
        expect(result).to.equal(null)
      })

      it('should maybe post a comment', function () {
        expect(utils.maybePostComment).to.have.been.calledWith(bumper.config, bumper.vcs, errorMsg, true)
      })

      it('should reject with an error', function () {
        expect(error).to.equal(errorMsg)
      })
    })

    describe('when coverage drops', function () {
      beforeEach(function (done) {
        bumper.config.baselineCoverage = 85.93
        sandbox.stub(utils, 'getCurrentCoverage').returns(84.99)
        errorMsg = 'Code Coverage: `84.99%` (dropped `0.94%` from `85.93%`)'

        bumper.checkCoverage()
          .then((resp) => {
            result = resp
          })
          .catch((err) => {
            error = err
          })

        setTimeout(() => {
          done()
        }, 0)
      })

      it('should not resolve', function () {
        expect(result).to.equal(null)
      })

      it('should maybe post a comment', function () {
        expect(utils.maybePostComment).to.have.been.calledWith(bumper.config, bumper.vcs, errorMsg)
      })

      it('should reject with an error', function () {
        expect(error).to.equal(errorMsg)
      })
    })

    describe('when coverage stays the same', function () {
      let msg
      beforeEach(function (done) {
        bumper.config.baselineCoverage = 85.93
        sandbox.stub(utils, 'getCurrentCoverage').returns(85.93)
        msg = 'Code Coverage: `85.93%` (no change)'

        bumper.checkCoverage()
          .then((resp) => {
            result = resp
          })
          .catch((err) => {
            error = err
          })

        setTimeout(() => {
          done()
        }, 0)
      })

      it('should resolve', function () {
        expect(result).to.equal(undefined)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })

      it('should maybe post a comment', function () {
        expect(utils.maybePostComment).to.have.been.calledWith(bumper.config, bumper.vcs, msg)
      })

      it('should log a message', function () {
        expect(logger.log).to.have.been.calledWith(msg, true)
      })
    })

    describe('when coverage increases', function () {
      let msg
      beforeEach(function (done) {
        bumper.config.baselineCoverage = 85.93
        sandbox.stub(utils, 'getCurrentCoverage').returns(88.01)
        msg = 'Code Coverage: `88.01%` (increased `2.08%` from `85.93%`)'

        bumper.checkCoverage()
          .then((resp) => {
            result = resp
          })
          .catch((err) => {
            error = err
          })

        setTimeout(() => {
          done()
        }, 0)
      })

      it('should resolve', function () {
        expect(result).to.equal(undefined)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })

      it('should maybe post a comment', function () {
        expect(utils.maybePostComment).to.have.been.calledWith(bumper.config, bumper.vcs, msg)
      })

      it('should log a message', function () {
        expect(logger.log).to.have.been.calledWith(msg, true)
      })
    })
  })

  describe('.bump()', function () {
    let result, info, error

    beforeEach(function () {
      result = null
      error = null
      bumper.config = {foo: 'bar', prependChangelog: true, dependencySnapshotFile: 'snapshot-file'}
      bumper.vcs = {foo: 'bar'}
      bumper.ci = {push () {}, getLastCommitMsg () {}}
      info = {scope: 'minor', changelog: '', version: '1.2.0'}
      sandbox.stub(bumper, '_maybePushChanges').returns(Promise.resolve('pushed'))
      sandbox.stub(bumper.ci, 'getLastCommitMsg')
      sandbox.stub(bumper, '_getMergedPrInfo').returns(Promise.resolve(info))
      sandbox.stub(bumper, '_maybeBumpVersion').returns(Promise.resolve(info))
      sandbox.stub(bumper, '_maybePrependChangelog').returns(Promise.resolve(info))
      sandbox.stub(bumper, '_maybeGenerateDependencySnapshot').returns(Promise.resolve(info))
      sandbox.stub(bumper, '_maybeCommitChanges').returns(Promise.resolve(info))
      sandbox.stub(bumper, '_maybeCreateTag').returns(Promise.resolve(info))
      sandbox.stub(bumper, '_maybeUpdateBaselineCoverage').returns(Promise.resolve(info))
      sandbox.stub(bumper, '_maybeGenerateDependencyComplianceReport').returns(Promise.resolve(info))
    })

    describe('when a merge build', function () {
      beforeEach(function (done) {
        bumper.ci.getLastCommitMsg.returns(Promise.resolve('foo bar'))
        bumper.bump()
          .then((res) => {
            result = res
          })
          .catch((err) => {
            error = err
          })
          .finally(() => {
            done()
          })
      })

      it('should get the merged pr info', function () {
        expect(bumper._getMergedPrInfo).to.have.callCount(1)
      })

      it('should maybe bump the version', function () {
        expect(bumper._maybeBumpVersion).to.have.been.calledWith(info, 'package.json')
      })

      it('should maybe prepend the changelog', function () {
        expect(bumper._maybePrependChangelog).to.have.been.calledWith(info)
      })

      it('should maybe generate the dependency snapshot', function () {
        expect(bumper._maybeGenerateDependencySnapshot).to.have.been.calledWith(info)
      })

      it('should maybe update baseline coverage', function () {
        expect(bumper._maybeUpdateBaselineCoverage).to.have.been.calledWith(info)
      })

      it('should maybe commit the change', function () {
        expect(bumper._maybeCommitChanges).to.have.been.calledWith(info)
      })

      it('should maybe create the tag', function () {
        expect(bumper._maybeCreateTag).to.have.been.calledWith(info)
      })

      it('should maybe run the dependencies', function () {
        expect(bumper._maybeGenerateDependencyComplianceReport).to.have.been.calledWith(info)
      })

      it('should maybe push the changes', function () {
        expect(bumper._maybePushChanges).to.have.been.calledWith(info)
      })

      it('should resolve with the result of the ci.push()', function () {
        expect(result).to.be.eql('pushed')
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })
    })

    describe(`when last commit was from ${pkgJson.name}`, function () {
      beforeEach(function (done) {
        bumper.ci.getLastCommitMsg.returns(Promise.resolve(`[${pkgJson.name}] Fizz bang`))
        bumper.bump()
          .then((res) => {
            result = res
          })
          .catch((err) => {
            error = err
          })
          .finally(() => {
            done()
          })
      })

      it('should not lookup merged PR info', function () {
        expect(bumper._getMergedPrInfo).to.have.callCount(0)
      })

      it('should not maybe bump version', function () {
        expect(bumper._maybeBumpVersion).to.have.callCount(0)
      })

      it('should not maybe prepend changelog', function () {
        expect(bumper._maybePrependChangelog).to.have.callCount(0)
      })

      it('should not maybe generate a dependency snapshot', function () {
        expect(bumper._maybeGenerateDependencySnapshot).to.have.callCount(0)
      })

      it('should not maybe calcualte dependencies', function () {
        expect(bumper._maybeGenerateDependencyComplianceReport).to.have.callCount(0)
      })

      it('should not maybe update baseline coverage', function () {
        expect(bumper._maybeUpdateBaselineCoverage).to.have.callCount(0)
      })

      it('should not maybe commit changes', function () {
        expect(bumper._maybeCommitChanges).to.have.callCount(0)
      })

      it('should not maybe create a tag', function () {
        expect(bumper._maybeCreateTag).to.have.callCount(0)
      })

      it('should not maybe push commit', function () {
        expect(bumper._maybePushChanges).to.have.callCount(0)
      })

      it('should not resolve', function () {
        expect(result).to.equal(null)
      })

      it('should reject with a Cancel', function () {
        expect(error).to.be.instanceof(Bumper.Cancel)
      })

      it('should reject with proper message', function () {
        expect(error.message).to.equal(`Skipping bump on ${pkgJson.name} commit.`)
      })
    })

    describe('when not a merge build', function () {
      beforeEach(function (done) {
        bumper.config.isPr = true
        bumper._getMergedPrInfo.reset()
        bumper.bump()
          .then((res) => {
            result = res
          })
          .catch((err) => {
            error = err
          })
          .finally(() => {
            done()
          })
      })

      it('should log that non merge builds are skipped', function () {
        expect(logger.log).to.have.been.calledWith('Not a merge build, skipping bump')
      })

      it('should not lookup merged PR info', function () {
        expect(bumper._getMergedPrInfo).to.have.callCount(0)
      })

      it('should not maybe bump version', function () {
        expect(bumper._maybeBumpVersion).to.have.callCount(0)
      })

      it('should not maybe prepend changelog', function () {
        expect(bumper._maybePrependChangelog).to.have.callCount(0)
      })

      it('should not maybe generate a dependency snapshot', function () {
        expect(bumper._maybeGenerateDependencySnapshot).to.have.callCount(0)
      })

      it('should not maybe calcualte dependencies', function () {
        expect(bumper._maybeGenerateDependencyComplianceReport).to.have.callCount(0)
      })

      it('should not maybe update baseline coverage', function () {
        expect(bumper._maybeUpdateBaselineCoverage).to.have.callCount(0)
      })

      it('should not maybe commit changes', function () {
        expect(bumper._maybeCommitChanges).to.have.callCount(0)
      })

      it('should not maybe create a tag', function () {
        expect(bumper._maybeCreateTag).to.have.callCount(0)
      })

      it('should not maybe push commit', function () {
        expect(bumper._maybePushChanges).to.have.callCount(0)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })
    })
  })

  describe('._getLastPr()', function () {
    let getPrResolver, resolution, rejection, promise

    beforeEach(function () {
      bumper.vcs = {getPr () {}}

      getPrResolver = {}
      const getPrPromise = new Promise((resolve, reject) => {
        getPrResolver.resolve = resolve
        getPrResolver.reject = reject
      })

      sandbox.stub(bumper.vcs, 'getPr').returns(getPrPromise)

      // actual results of git log -10 --oneline on pr-bumper repo
      const gitLog =
        '98a148c Added some more tests, just a few more to go\n' +
        '1b1bd97 Added some real unit tests\n' +
        'edf85e0 Merge pull request #30 from job13er/remove-newline\n' +
        'fa066f2 Removed newline from parsed PR number\n' +
        'fc416cc Merge pull request #29 from job13er/make-bumping-more-robust\n' +
        '67db358 Fix for #26 by reading PR # from git commit\n' +
        '4a61a20 Automated version bump\n' +
        '7db44e1 Merge pull request #24 from sandersky/master\n' +
        'f571451 add pullapprove config\n' +
        '4398a26 address PR concerns\n'

      execStub.returns(Promise.resolve(gitLog))
      promise = bumper._getLastPr()
        .then((pr) => {
          resolution = pr
          return pr
        })
        .catch((err) => {
          rejection = err
          throw err
        })
    })

    it('should call git log', function () {
      expect(execStub).to.have.been.calledWith('git log -10 --oneline')
    })

    describe('when getPr succeeds', function () {
      beforeEach(function () {
        getPrResolver.resolve('the-pr')
        return promise
      })

      it('should parse out the PR number from the git log and passes it to vcs.getPr()', function () {
        expect(bumper.vcs.getPr).to.have.been.calledWith('30')
      })

      it('should resolve with the pr', function () {
        expect(resolution).to.be.equal('the-pr')
      })
    })

    describe('when getPr fails', function () {
      beforeEach(function (done) {
        getPrResolver.reject('the-error')
        promise.catch(() => {
          done()
        })
      })

      it('should parse out the PR number from the git log and passes it to vcs.getPr()', function () {
        expect(bumper.vcs.getPr).to.have.been.calledWith('30')
      })

      it('should reject with the error', function () {
        expect(rejection).to.be.equal('the-error')
      })
    })
  })

  describe('._getMergedPrInfo()', function () {
    ;['major', 'minor', 'patch'].forEach(function (scope) {
      describe(`when scope is ${scope}`, function () {
        let result

        beforeEach(function () {
          bumper.config = {foo: 'bar'}
          bumper.vcs = {bar: 'baz'}

          sandbox.stub(bumper, '_getLastPr').returns(Promise.resolve('the-pr'))
          sandbox.stub(utils, 'getScopeForPr').returns(scope)
          sandbox.stub(utils, 'getChangelogForPr').returns('my-changelog')
        })

        describe('when prependChangelog is set', function () {
          beforeEach(function () {
            bumper.config.prependChangelog = true
            return bumper._getMergedPrInfo().then((res) => {
              result = res
            })
          })

          it('should get the last PR to be merged', function () {
            expect(bumper._getLastPr).to.have.callCount(1)
          })

          it('should gets the scope for the given pr', function () {
            expect(utils.getScopeForPr).to.have.been.calledWith('the-pr')
          })

          it('should get the changelog for the given pr', function () {
            expect(utils.getChangelogForPr).to.have.been.calledWith('the-pr')
          })

          it('should resolve with the info', function () {
            expect(result).to.be.eql({changelog: 'my-changelog', modifiedFiles: [], scope})
          })
        })

        describe('when prependChangelog is not set', function () {
          beforeEach(function () {
            bumper.config.prependChangelog = false
            return bumper._getMergedPrInfo().then((res) => {
              result = res
            })
          })

          it('should get the last PR to be merged', function () {
            expect(bumper._getLastPr).to.have.callCount(1)
          })

          it('should gets the scope for the given pr', function () {
            expect(utils.getScopeForPr).to.have.been.calledWith('the-pr')
          })

          it('should not get the changelog for the given pr', function () {
            expect(utils.getChangelogForPr).to.have.callCount(0)
          })

          it('should resolve with the info', function () {
            expect(result).to.be.eql({changelog: '', modifiedFiles: [], scope})
          })
        })
      })
    })

    describe('when scope is none', function () {
      let result

      beforeEach(function () {
        bumper.config = {foo: 'bar'}
        bumper.vcs = {bar: 'baz'}

        sandbox.stub(bumper, '_getLastPr').returns(Promise.resolve('the-pr'))
        sandbox.stub(utils, 'getScopeForPr').returns('none')
        sandbox.stub(utils, 'getChangelogForPr').returns('my-changelog')
      })

      describe('when prependChangelog is set', function () {
        beforeEach(function () {
          bumper.config.prependChangelog = true
          return bumper._getMergedPrInfo().then((res) => {
            result = res
          })
        })

        it('should get the last PR to be merged', function () {
          expect(bumper._getLastPr).to.have.callCount(1)
        })

        it('should gets the scope for the given pr', function () {
          expect(utils.getScopeForPr).to.have.been.calledWith('the-pr')
        })

        it('should not get the changelog for the given pr', function () {
          expect(utils.getChangelogForPr).to.have.callCount(0)
        })

        it('should resolve with the info', function () {
          expect(result).to.be.eql({changelog: '', modifiedFiles: [], scope: 'none'})
        })
      })

      describe('when prependChangelog is not set', function () {
        beforeEach(function () {
          bumper.config.prependChangelog = false
          return bumper._getMergedPrInfo().then((res) => {
            result = res
          })
        })

        it('should get the last PR to be merged', function () {
          expect(bumper._getLastPr).to.have.callCount(1)
        })

        it('should gets the scope for the given pr', function () {
          expect(utils.getScopeForPr).to.have.been.calledWith('the-pr')
        })

        it('should not get the changelog for the given pr', function () {
          expect(utils.getChangelogForPr).to.have.callCount(0)
        })

        it('should resolve with the info', function () {
          expect(result).to.be.eql({changelog: '', modifiedFiles: [], scope: 'none'})
        })
      })
    })
  })

  describe('._getOpenPrInfo()', function () {
    let result
    beforeEach(function () {
      bumper.config = {foo: 'bar', prNumber: '123'}
      bumper.vcs = {getPr () {}}

      sandbox.stub(bumper.vcs, 'getPr').returns(Promise.resolve('the-pr'))
      sandbox.stub(utils, 'getScopeForPr').returns('patch')
      sandbox.stub(utils, 'getChangelogForPr').returns('the-changelog')
      sandbox.spy(utils, 'maybePostCommentOnError')
    })

    describe('when prependChangelog is set', function () {
      beforeEach(function () {
        bumper.config.prependChangelog = true
        return bumper._getOpenPrInfo().then((res) => {
          result = res
        })
      })

      it('should fetch the PR', function () {
        expect(bumper.vcs.getPr).to.have.been.calledWith('123')
      })

      it('should get the scope for the given pr', function () {
        expect(utils.getScopeForPr).to.have.been.calledWith('the-pr')
      })

      it('should get the changelog for the given pr', function () {
        expect(utils.getChangelogForPr).to.have.been.calledWith('the-pr')
      })

      it('should resolve with the info', function () {
        expect(result).to.be.eql({
          changelog: 'the-changelog',
          scope: 'patch'
        })
      })

      describe('the first call to maybePostCommentOnError()', function () {
        let args
        beforeEach(function () {
          args = utils.maybePostCommentOnError.firstCall.args
        })

        it('should pass in the config', function () {
          expect(args[0]).to.equal(bumper.config)
        })

        it('should pass in the vcs', function () {
          expect(args[1]).to.equal(bumper.vcs)
        })

        describe('when the wrapped function is called', function () {
          let ret
          beforeEach(function () {
            utils.getScopeForPr.reset()
            ret = args[2]()
          })

          it('should get the scope', function () {
            expect(utils.getScopeForPr).to.have.been.calledWith('the-pr')
          })

          it('should return the pr and scope', function () {
            expect(ret).to.eql({
              pr: 'the-pr',
              scope: 'patch'
            })
          })
        })
      })

      describe('the second call to maybePostCommentOnError()', function () {
        let args
        beforeEach(function () {
          args = utils.maybePostCommentOnError.secondCall.args
        })

        it('should pass in the config', function () {
          expect(args[0]).to.equal(bumper.config)
        })

        it('should pass in the vcs', function () {
          expect(args[1]).to.equal(bumper.vcs)
        })

        describe('when the wrapped function is called', function () {
          let ret
          beforeEach(function () {
            utils.getChangelogForPr.reset()
            ret = args[2]()
          })

          it('should get the changelog', function () {
            expect(utils.getChangelogForPr).to.have.been.calledWith('the-pr')
          })

          it('should return the changelog and scope', function () {
            expect(ret).to.eql({
              changelog: 'the-changelog',
              scope: 'patch'
            })
          })
        })
      })
    })

    describe('when prependChangelog is not set', function () {
      beforeEach(function () {
        bumper.config.prependChangelog = false
        return bumper._getOpenPrInfo().then((res) => {
          result = res
        })
      })

      it('should fetch the PR', function () {
        expect(bumper.vcs.getPr).to.have.been.calledWith('123')
      })

      it('should get the scope for the given pr', function () {
        expect(utils.getScopeForPr).to.have.been.calledWith('the-pr')
      })

      it('should not get the changelog for the given pr', function () {
        expect(utils.getChangelogForPr).to.have.callCount(0)
      })

      it('should resolve with the info', function () {
        expect(result).to.be.eql({
          changelog: '',
          scope: 'patch'
        })
      })
    })
  })

  describe('._maybeBumpVersion()', function () {
    const ctx = {}

    beforeEach(function () {
      ctx.bumper = bumper

      let original = path.join(__dirname, '_package.json')
      return exec(`cp ${original} _package.json`)
    })

    afterEach(function () {
      return exec('rm -f _package.json')
    })

    testMaybeBumpVersion(ctx, 'none', '1.2.3')
    testMaybeBumpVersion(ctx, 'patch', '1.2.4')
    testMaybeBumpVersion(ctx, 'minor', '1.3.0')
    testMaybeBumpVersion(ctx, 'major', '2.0.0')

    describe('an invalid scope', function () {
      let info
      beforeEach(function () {
        info = {scope: 'foo'}
      })

      it('should throw an Error', function () {
        expect(() => {
          bumper._maybeBumpVersion(info, '_package.json')
        }).to.throw('Invalid scope [foo]')
      })
    })
  })

  describe('._maybeCommitChanges()', function () {
    let info, result, error

    beforeEach(function () {
      info = {
        changelog: 'stuff changed',
        modifiedFiles: [],
        scope: 'patch'
      }
      __.set(bumper.config, 'ci.buildNumber', '12345')

      bumper.ci = {
        add () {},
        commit () {},
        setupGitEnv () {}
      }

      sandbox.stub(bumper.ci, 'add').returns(Promise.resolve())
      sandbox.stub(bumper.ci, 'commit').returns(Promise.resolve())
      sandbox.stub(bumper.ci, 'setupGitEnv').returns(Promise.resolve())
    })

    describe('when no files were modified', function () {
      beforeEach(function (done) {
        result = error = null
        bumper._maybeCommitChanges(info)
          .then((r) => {
            result = r
          })
          .catch((e) => {
            error = e
          })
          .finally(() => {
            done()
          })
      })

      it('should log info about skipping', function () {
        expect(logger.log).to.have.been.calledWith('Skipping commit because no files were changed.')
      })

      it('should not set up the git env', function () {
        expect(bumper.ci.setupGitEnv).to.have.callCount(0)
      })

      it('should not add any files', function () {
        expect(bumper.ci.add).to.have.callCount(0)
      })

      it('should not commit any files', function () {
        expect(bumper.ci.commit).to.have.callCount(0)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })

    describe('when files were modified', function () {
      beforeEach(function (done) {
        info.modifiedFiles = [
          'fizz',
          'bang'
        ]
        result = error = null
        bumper._maybeCommitChanges(info)
          .then((r) => {
            result = r
          })
          .catch((e) => {
            error = e
          })
          .finally(() => {
            done()
          })
      })

      it('should not log info about skipping', function () {
        expect(logger.log).to.have.callCount(0)
      })

      it('should set up the git env', function () {
        expect(bumper.ci.setupGitEnv).to.have.callCount(1)
      })

      it('should add the rightfiles', function () {
        expect(bumper.ci.add).to.have.been.calledWith(['fizz', 'bang'])
      })

      it('should commit with version bump message', function () {
        const msg = `[${pkgJson.name}] Automated version bump`
        const descr = 'From CI build 12345'
        expect(bumper.ci.commit).to.have.been.calledWith(msg, descr)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })

    describe('when files were modified, and none scope', function () {
      beforeEach(function (done) {
        info.scope = 'none'
        info.modifiedFiles = [
          'fizz',
          'bang'
        ]
        result = error = null
        bumper._maybeCommitChanges(info)
          .then((r) => {
            result = r
          })
          .catch((e) => {
            error = e
          })
          .finally(() => {
            done()
          })
      })

      it('should not log info about skipping', function () {
        expect(logger.log).to.have.callCount(0)
      })

      it('should set up the git env', function () {
        expect(bumper.ci.setupGitEnv).to.have.callCount(1)
      })

      it('should add the rightfiles', function () {
        expect(bumper.ci.add).to.have.been.calledWith(['fizz', 'bang'])
      })

      it('should commit with coverage message', function () {
        const msg = `[${pkgJson.name}] Automated code coverage update`
        const descr = 'From CI build 12345'
        expect(bumper.ci.commit).to.have.been.calledWith(msg, descr)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })
  })

  describe('._maybeCreateTag()', function () {
    let result, info

    beforeEach(function () {
      info = {
        version: '1.2.3'
      }
      __.set(bumper.config, 'ci.buildNumber', '12345')
      bumper.ci = {
        tag () {}
      }

      sandbox.stub(bumper.ci, 'tag').returns(Promise.resolve('tagged'))
      execStub.returns(Promise.resolve())
    })

    describe('when scope is not "none"', function () {
      beforeEach(function () {
        return bumper._maybeCreateTag(info)
          .then((res) => {
            result = res
          })
      })

      it('should create a tag', function () {
        expect(bumper.ci.tag).to.have.been.calledWith('v1.2.3', 'Generated tag from CI build 12345')
      })

      it('should resolve with the result of the tag', function () {
        expect(result).to.be.equal(info)
      })
    })

    describe('when scope is "none"', function () {
      beforeEach(function () {
        info.scope = 'none'
        return bumper._maybeCreateTag(info)
          .then((res) => {
            result = res
          })
      })

      it('should not create a tag', function () {
        expect(bumper.ci.tag).to.have.callCount(0)
      })

      it('should resolve with the result of the tag', function () {
        expect(result).to.be.equal(info)
      })
    })
  })

  describe('._maybeGenerateDependencyComplianceReport()', function () {
    let result, info
    beforeEach(function () {
      info = {
        modifiedFiles: [],
        scope: 'none'
      }
    })

    describe('when no dir is configured', function () {
      beforeEach(function () {
        return bumper._maybeGenerateDependencyComplianceReport(info)
          .then((r) => {
            result = r
          })
      })

      it('should log info about skipping b/c of config', function () {
        const msg = 'Skipping generating dependency compliance report because of config option.'
        expect(logger.log).to.have.been.calledWith(msg)
      })

      it('should not generate dependencies', function () {
        expect(depStub.run).to.have.callCount(0)
      })

      it('should return a promise resolving with info', function () {
        expect(result).to.equal(info)
      })
    })

    describe('when an out dir is configured, but scope is "none"', function () {
      beforeEach(function () {
        __.set(bumper.config, 'dependencies.output.directory', 'blackduck/')
        return bumper._maybeGenerateDependencyComplianceReport(info)
          .then((r) => {
            result = r
          })
      })

      it('should log info about skipping b/c of scope', function () {
        const msg = 'Skipping generating dependency compliance report because of "none" scope.'
        expect(logger.log).to.have.been.calledWith(msg)
      })

      it('should not generate dependencies', function () {
        expect(depStub.run).to.have.callCount(0)
      })

      it('should return a promise resolving with info', function () {
        expect(result).to.equal(info)
      })
    })

    describe('when an out dir is configured, and scope is not "none"', function () {
      let cwd, globalPath
      beforeEach(function () {
        info.scope = 'patch'
        cwd = process.cwd()
        globalPath = path.join(cwd, 'blackduck/')
        __.set(bumper.config, 'dependencies.output.directory', 'blackduck/')
        return bumper._maybeGenerateDependencyComplianceReport(info)
          .then((r) => {
            result = r
          })
      })

      it('should not log anything', function () {
        expect(logger.log).to.have.callCount(0)
      })

      it('should generate dependencies', function () {
        expect(depStub.run).to.have.been.calledWith(cwd, globalPath, bumper.config)
      })

      it('should add "blackduck/" to the list of files modified', function () {
        expect(info.modifiedFiles).to.include('blackduck/')
      })

      it('should return a promise resolving with info', function () {
        expect(result).to.equal(info)
      })
    })
  })

  describe('._maybeGenerateDependencySnapshot()', function () {
    let ret, info
    beforeEach(function () {
      info = {
        modifiedFiles: [],
        scope: 'patch'
      }
      bumper.config.dependencySnapshotFile = 'snapshot-file'
      execStub.withArgs('npm prune').returns(Promise.resolve('prune-done'))
      execStub.withArgs('npm shrinkwrap --dev').returns(Promise.resolve('shrinkwrap-done'))
      execStub.returns(Promise.resolve('move-done'))
    })

    describe('when no snapshot file defined', function () {
      beforeEach(function () {
        bumper.config.dependencySnapshotFile = ''
        return bumper._maybeGenerateDependencySnapshot(info)
          .then((resp) => {
            ret = resp
          })
      })

      it('should log a message about why it is skipping', function () {
        const msg = 'Skipping generating dependency snapshot because of config option.'
        expect(logger.log).to.have.been.calledWith(msg)
      })

      it('should not prune node_modules so shrinkwrap will work', function () {
        expect(execStub).not.to.have.been.calledWith('npm prune')
      })

      it('should not generate the dependency snapshot', function () {
        expect(execStub).not.to.have.been.calledWith('npm shrinkwrap --dev')
      })

      it('should not add the dependencySnapshotFile to the list of modified files', function () {
        expect(info.modifiedFiles).to.have.length(0)
      })

      it('should return the info', function () {
        expect(ret).to.equal(info)
      })
    })

    describe('when scope is "none"', function () {
      beforeEach(function () {
        info.scope = 'none'
        return bumper._maybeGenerateDependencySnapshot(info)
          .then((resp) => {
            ret = resp
          })
      })

      it('should log a message about why it is skipping', function () {
        const msg = 'Skipping generating dependency snapshot because of "none" scope.'
        expect(logger.log).to.have.been.calledWith(msg)
      })

      it('should not prune node_modules so shrinkwrap will work', function () {
        expect(execStub).not.to.have.been.calledWith('npm prune')
      })

      it('should not generate the dependency snapshot', function () {
        expect(execStub).not.to.have.been.calledWith('npm shrinkwrap --dev')
      })

      it('should not add the dependencySnapshotFile to the list of modified files', function () {
        expect(info.modifiedFiles).to.have.length(0)
      })

      it('should return the info', function () {
        expect(ret).to.equal(info)
      })
    })

    describe('when snapshot file defined and scope is not "none"', function () {
      beforeEach(function () {
        return bumper._maybeGenerateDependencySnapshot(info)
          .then((resp) => {
            ret = resp
          })
      })

      it('should prune node_modules so shrinkwrap will work', function () {
        expect(execStub).to.have.been.calledWith('npm prune')
      })

      it('should generate the dependency snapshot', function () {
        expect(execStub).to.have.been.calledWith('npm shrinkwrap --dev')
      })

      it('should rename the dependency snapshot', function () {
        expect(execStub).to.have.been.calledWith('mv npm-shrinkwrap.json snapshot-file')
      })

      it('should add the dependencySnapshotFile to the list of modified files', function () {
        expect(info.modifiedFiles).to.include(bumper.config.dependencySnapshotFile)
      })

      it('should return the info', function () {
        expect(ret).to.equal(info)
      })
    })
  })

  describe('._maybePrependChangelog()', function () {
    let result, info
    beforeEach(function () {
      info = {
        changelog: 'the-changelog-content',
        scope: 'patch',
        modifiedFiles: [],
        version: '1.2.3'
      }
      prependStub.returns(Promise.resolve('return-value'))
    })

    describe('when prependChangelog is false', function () {
      beforeEach(function () {
        bumper.config.prependChangelog = false
        bumper.config.changelogFile = 'the-changelog-file'

        return bumper._maybePrependChangelog(info)
          .then((resp) => {
            result = resp
          })
      })

      it('should log a message explaining why it is skipping', function () {
        const msg = 'Skipping prepending changelog because of config option.'
        expect(logger.log).to.have.been.calledWith(msg)
      })

      it('should not prepend the changelog', function () {
        expect(prependStub).to.have.callCount(0)
      })

      it('should not add the changelog file to the modifiedFiles list', function () {
        expect(info.modifiedFiles).not.to.include('the-changelog-file')
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })

    describe('when scope is "none"', function () {
      beforeEach(function () {
        info.scope = 'none'
        delete info.version
        bumper.config.prependChangelog = true
        bumper.config.changelogFile = 'the-changelog-file'

        return bumper._maybePrependChangelog(info)
          .then((resp) => {
            result = resp
          })
      })

      it('should log a message explaining why it is skipping', function () {
        const msg = 'Skipping prepending changelog because of "none" scope.'
        expect(logger.log).to.have.been.calledWith(msg)
      })

      it('should not prepend the changelog', function () {
        expect(prependStub).to.have.callCount(0)
      })

      it('should not add the changelog file to the modifiedFiles list', function () {
        expect(info.modifiedFiles).not.to.include('the-changelog-file')
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })

    describe('when prependChangelog is true and scope is not "none"', function () {
      beforeEach(function () {
        info.scope = 'patch'
        bumper.config.prependChangelog = true
        bumper.config.changelogFile = 'the-changelog-file'

        return bumper._maybePrependChangelog(info)
          .then((resp) => {
            result = resp
          })
      })

      it('should not log a message explaining why it is skipping', function () {
        expect(logger.log).to.have.callCount(0)
      })

      it('should prepend the changelog', function () {
        const now = new Date()
        const dateString = now.toISOString().split('T').slice(0, 1).join('')
        const data = `# ${info.version} (${dateString})\n${info.changelog}\n\n`
        expect(prependStub).to.have.been.calledWith('the-changelog-file', data)
      })

      it('should add the changelog file to the modifiedFiles list', function () {
        expect(info.modifiedFiles).to.include('the-changelog-file')
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })
  })

  describe('_maybePushChanges()', function () {
    let result, info
    beforeEach(function () {
      info = {
        modifiedFiles: [],
        scope: 'none'
      }
      bumper.ci = {
        push: sandbox.stub().returns(Promise.resolve('pushed'))
      }
    })

    describe('when nothing changed', function () {
      beforeEach(function () {
        return bumper._maybePushChanges(info)
          .then((r) => {
            result = r
          })
      })

      it('should log a message about why it is skipping', function () {
        expect(logger.log).to.have.been.calledWith('Skipping push because nothing changed.')
      })

      it('should not push the change', function () {
        expect(bumper.ci.push).to.have.callCount(0)
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })

    describe('when something changed', function () {
      beforeEach(function () {
        info.modifiedFiles = ['package.json']
        return bumper._maybePushChanges(info)
          .then((r) => {
            result = r
          })
      })

      it('should not log a message about why it is skipping', function () {
        expect(logger.log).to.have.callCount(0)
      })

      it('should push the change', function () {
        expect(bumper.ci.push).to.have.been.calledWith(bumper.vcs)
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })
    })
  })

  describe('_maybeUpdateBaselineCoverage()', function () {
    let info, _pkgJson, result, error
    beforeEach(function () {
      info = {
        modifiedFiles: [],
        scope: 'none'
      }

      writeFileStub.returns(Promise.resolve('written'))
      sandbox.stub(utils, 'getCurrentCoverage')
    })

    describe('when no baseline coverage present', function () {
      beforeEach(function (done) {
        _pkgJson = {}
        readFileStub.returns(Promise.resolve(JSON.stringify(_pkgJson, null, 2)))

        result = error = null
        bumper._maybeUpdateBaselineCoverage(info)
          .then((r) => {
            result = r
          })
          .catch((e) => {
            error = e
          })
          .finally(() => {
            done()
          })
      })

      it('should log a message about why it is not updating coverage', function () {
        const msg = 'Skipping updating baseline code coverage because no valid coverage found.'
        expect(logger.log).to.have.been.calledWith(msg)
      })

      it('should not lookup current coverage', function () {
        expect(utils.getCurrentCoverage).to.have.callCount(0)
      })

      it('should not read from a file', function () {
        expect(readFileStub).to.have.callCount(0)
      })

      it('should not write to a file', function () {
        expect(writeFileStub).to.have.callCount(0)
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })
    })

    describe('when no current coverage present', function () {
      beforeEach(function (done) {
        _pkgJson = {}
        readFileStub.returns(Promise.resolve(JSON.stringify(_pkgJson, null, 2)))
        bumper.config.baselineCoverage = 99.93
        utils.getCurrentCoverage.returns(-1)

        result = error = null
        bumper._maybeUpdateBaselineCoverage(info)
          .then((r) => {
            result = r
          })
          .catch((e) => {
            error = e
          })
          .finally(() => {
            done()
          })
      })

      it('should lookup current coverage', function () {
        expect(utils.getCurrentCoverage).to.have.callCount(1)
      })

      it('should not read from a file', function () {
        expect(readFileStub).to.have.callCount(0)
      })

      it('should not write to a file', function () {
        expect(writeFileStub).to.have.callCount(0)
      })

      it('should not add "package.json" to the list of modified files', function () {
        expect(info.modifiedFiles).not.to.include('package.json')
      })

      it('should not resolve', function () {
        expect(result).to.equal(null)
      })

      it('should reject with an appropriate error', function () {
        const link = 'https://github.com/ciena-blueplanet/pr-bumper#code-coverage'
        const msg = `No current coverage info found!\nSee ${link} for configuration info.`
        expect(error).to.equal(msg)
      })
    })

    describe('when current coverage and baseline present', function () {
      let location
      beforeEach(function (done) {
        _pkgJson = {
          foo: 'bar',
          'pr-bumper': {
            coverage: 99.15
          }
        }
        readFileStub.returns(Promise.resolve(JSON.stringify(_pkgJson, null, 2)))
        location = path.join(process.cwd(), 'package.json')

        bumper.config.baselineCoverage = 99.15
        utils.getCurrentCoverage.returns(99.57)
        writeFileStub.returns(Promise.resolve('written'))
        result = error = null
        bumper._maybeUpdateBaselineCoverage(info, _pkgJson)
          .then((r) => {
            result = r
          })
          .catch((e) => {
            error = e
          })
          .finally(() => {
            done()
          })
      })

      it('should lookup current coverage', function () {
        expect(utils.getCurrentCoverage).to.have.callCount(1)
      })

      it('should read previous contents of the "package.json" file', function () {
        expect(readFileStub).to.have.been.calledWith(location, 'utf8')
      })

      it('should write new contents of the "package.json" file', function () {
        const newPkgJson = __.cloneDeep(_pkgJson)
        newPkgJson['pr-bumper'].coverage = 99.57
        expect(writeFileStub).to.have.been.calledWith(location, JSON.stringify(newPkgJson, null, 2))
      })

      it('should add "package.json" to the list of modified files', function () {
        expect(info.modifiedFiles).to.include('package.json')
      })

      it('should resolve with the info', function () {
        expect(result).to.equal(info)
      })

      it('should not reject', function () {
        expect(error).to.equal(null)
      })
    })
  })
})
