const _ = require('lodash')
const yaml = require('js-yaml')
const jp = require('fs-jetpack')
const Log = require('./Log')
const costTiers = require('../constants/cost-tiers.json')
const messages = require('./messages')
const pipe = require('./pipe')
const interpolateYaml = require('./interpolate-yaml')

const triggerTickPath = `./data/zmagic/functions/triggers/spells/tick.mcfunction`
const initPath = `./data/zmagic/functions/init/spells.mcfunction`


class Spell {
  constructor() {
    this.import           = this.import.bind(this)
    this.importAll        = this.importAll.bind(this)
    this.process          = this.process.bind(this)
    this.processAll       = this.processAll.bind(this)
    this.buildMcFunction  = this.buildMcFunction.bind(this)
    this.buildMcFunctions = this.buildMcFunctions.bind(this)
    this.writeTriggers    = this.writeTriggers.bind(this)
    this.write            = this.write.bind(this)
    this.writeAll         = this.writeAll.bind(this)

    this.log = new Log('./logs/spell-triggers.txt')


    this.colors = _.reduce(costTiers, (result, value, key) => {
      return _.set(result, `${key}`, value.color)
    }, {})
  }

  payGate(spell, tier) {
    const costTier  = spell.tier.costTier
    const costTable = costTiers[spell.costTableName]
    const resource  = costTiers[spell.costTableName].resource
    let lines = []

    lines.push(`execute unless score ${spell.executor} ${resource} >= ${costTier} ${costTable.name} run tellraw ${spell.executor} ${messages.cantAfford(costTier, costTable)}`)
    spell.commands.forEach(command => {
      lines.push(`execute if score ${spell.executor} ${resource} >= ${costTier} ${costTable.name} run ${command}`)
    })
    lines.push(`execute if score ${spell.executor} ${resource} >= ${costTier} ${costTable.name} run clear ${spell.executor} minecraft:${resource} ${costTable.tiers[costTier]}`)

    return lines
  }

  import(path) {
    console.log('  '+path)
    return jp.read(path)
  }

  importAll(spellsPath) {
    console.log('IMPORTING SPELLS...')
    let spellYamls = []
    const spellFileNames = jp.list(spellsPath).filter(fileName => {
      return fileName.match('.yaml')
    })
    spellFileNames.map(fileName => {
      const path = spellsPath + fileName
      spellYamls.push(this.import(path))
    })
    return spellYamls
  }

  process(importedSpellYaml, tier) {
    const rawJson = yaml.load(importedSpellYaml)
    const processedSpell = yaml.load(interpolateYaml(importedSpellYaml, {tier: tier}))
    processedSpell.tier = tier
    const isOneOff = rawJson.tiers.length <= 1
    processedSpell.id = isOneOff
      ? _.snakeCase(processedSpell.name)
      : _.snakeCase(`${processedSpell.name}_${processedSpell.tier.name}`)
    console.log('  '+processedSpell.name+' '+(isOneOff ? '' : processedSpell.tier.name));
    return processedSpell
  }

  processAll(importedSpellYamls) {
    console.log('PROCESSING SPELLS...');
    let processedSpells = []
    importedSpellYamls.map(spellYaml => {
    const rawJson = yaml.load(spellYaml)
      rawJson.tiers.map(tier => {
        processedSpells.push(this.process(spellYaml, tier))
      })
    })
    return processedSpells
  }

  buildMcFunction(hydratedSpell) {
    return this.payGate(hydratedSpell)
  }

  buildMcFunctions(hydratedSpells) {
    return hydratedSpells.map(hydratedSpell => {
      return this.buildMcFunction(hydratedSpell)
    })
  }

  writeTriggers(processedSpells) {
    console.log('WRITING SPELL TRIGGERS...')

    let commands = []

    commands.push('scoreboard players enable @a cast_spell')

    processedSpells.forEach(spell => {
      this.log.push({
        trigger: spell.tier.trigger,
        id: spell.id
      })
      commands.push(`execute as @a[scores={cast_spell=${spell.tier.trigger}}] run function zmagic:cast/${spell.id}`)
    })
    commands.push('scoreboard players set @a cast_spell -1')

    this.log.write()

    const mcFunction = commands.join('\n')
    jp.write(triggerTickPath, mcFunction)

    const initCommand = 'scoreboard objectives add cast_spell trigger'
    jp.write(initPath, initCommand)
    console.log('  '+triggerTickPath)
  }

  write(processedSpell) {
    const rawJson = processedSpell
    const isOneOff = rawJson.tiers.length <= 1
    const functionPath = `./data/zmagic/functions/cast/${processedSpell.id}.mcfunction`
    console.log('  '+functionPath)
    const mcFunction = this.buildMcFunction(processedSpell).join('\n')
    jp.write(functionPath, mcFunction)
  }

  writeAll(processedSpells) {
    console.log('WRITING SPELLS...')

    processedSpells.map(spell => {
      this.write(spell)
    })
  }

}


module.exports = Spell