import { GitEmoji } from 'commit-it'

export default {
  plugins: [
    new GitEmoji({
      askForShortDescription: false,
      commitBodyRequired: false
    })
  ]
}
