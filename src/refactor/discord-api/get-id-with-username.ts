import { Guild } from 'discord.js'

async function getIdWithUsername(guild: Guild, username: string) {
  const members = await guild.members.search({ query: username, limit: 1 })

  if (members.size <= 0) {
    console.warn(`⚠️ Could not find Discord user for ${username}`)
    return null
  }

  const member = members.first()
  if (!member) {
    console.warn(`⚠️ Could not find Discord user for ${username}`)
    return null
  }
  
  console.log(`✅ Resolved ${username} to Discord ID ${member.id}`)
  return member.id
}

export {
  getIdWithUsername,
}