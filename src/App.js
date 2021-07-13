import React, { Component } from "react";
import '@fontsource/roboto';

import ScopedCssBaseline from '@material-ui/core/ScopedCssBaseline';

import * as Mui from '@material-ui/core';

import EntityOfferRegistry from "./contracts/EntityOfferRegistry.json";

import Web3 from "web3";

class App extends Component {
  state = { accounts: null,
            isLoaded: false,
            currentBalance: 'unavailable',
            showAccountNotification: false,
            showEntityRegistryNotification: false,
            newOfferRegistryNotification: null,
            newOfferNotification: null,
            offerRegistryContractAddress: null,
            offerAdresses: [],
            allOffersDetails: [],
            subscriptionTime: 30
          };

  componentDidMount = async () => {
    // TODO: incremental check for each step (isLoaded = logical AND over all steps)
    window.App = this;
    this.web3 = await this.getWeb3Metamask();
    await this.updateAccounts();
    this.handleMetaMaskAccountChange();

    this.setState({ isLoaded: true });

    console.log(this.state);
  };

  getWeb3Metamask = () => new Promise((resolve, reject) => {
    // Wait for loading completion to avoid race conditions with web3 injection timing.
    window.addEventListener("load", async () => {
      if (window.ethereum) {
        const web3 = new Web3(window.ethereum);
        try {
          // Request account access if needed
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          // Acccounts now exposed
          resolve(web3);
        } catch (error) {
          reject(error);
        }
      } else {
        console.log("No web3 instance injected, using Local web3.");
        reject();
      }
    })
    }
  )

  updateAccounts = async () => {
    try {
      this.setState({ isLoaded: false });
      let accounts = await this.web3.eth.getAccounts();
      this.setState({ accounts });
      await this.updateAccountBalance();
    
      this.setState({ isLoaded: true });


      console.log("Loaded account: ", this.state.accounts[0]);
    } catch (error) {
      alert(
        `Failed to load accounts. Check console for details.`,
      );
      console.error(error);
    }
  }

  updateAccountBalance = async () => {
    let currentBalance = this.web3.utils.fromWei(await this.web3.eth.getBalance(this.state.accounts[0]), "ether");
    this.setState({ currentBalance });
  }

  handleMetaMaskAccountChange = () => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', async () => {
        await this.updateAccounts();
      });
    }
  }

  getContractInstance = async (contractJSON, isWebSocket = false, customAdress = null) => {
    const localWeb3 = isWebSocket ? this.web3WebSocket : this.web3;
    try {
      if (customAdress) {
        return new localWeb3.eth.Contract(contractJSON.abi, customAdress);
      }

      const networkId = await localWeb3.eth.net.getId();
      const deployedNetwork = contractJSON.networks[networkId];

      return new localWeb3.eth.Contract(contractJSON.abi, deployedNetwork && deployedNetwork.address);
    } catch (err) {
      console.error(err);
    }
  }
  

  handleInputChange = (event) => {
    const target = event.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const name = target.name;

    console.log("state change ", name, value);
    this.setState({
      [name]: value
    });
  }

  getAllOffers = async () => {
    if (! Boolean(this.state.offerRegistryContractAddress)) {
      this.setState({ allOffersDetails: [] });
      return;
    }
    let offerRegistryInstance = await this.getContractInstance(EntityOfferRegistry, false, this.state.offerRegistryContractAddress);

    const offerCount = await offerRegistryInstance.methods.offerCount().call();

    let offersListBuilder = [];
    for (let i=0; i < offerCount; i++) {
      const offer = await offerRegistryInstance.methods.entityOffers(i).call();
      const offerExpiration = await offerRegistryInstance.methods.subscribers(this.state.accounts[0], i).call();
      offersListBuilder.push({
        index: i,
        offerName: offer.offerName,
        baseFee: offer.baseFee,
        minimumSubscriptionTime: offer.minimumSubscriptionTime,
        isRetired: offer.isRetired,
        expirationTime: offerExpiration == 0 ? '<not active>' : (new Date(offerExpiration*1000)).toLocaleString()
      });
    }
    this.setState({ allOffersDetails: offersListBuilder });
  }

  loadOffersFromContract = async () => {
    let offerRegistryContractInstance = await this.getContractInstance(EntityOfferRegistry, true, this.state.offerRegistryContractAddress);
    console.log(offerRegistryContractInstance);
    await this.getAllOffers();
  }

  createSubscription = async () => {
    let selectedOfferIndex = this.state.subscriptionInfo.index;
    let offerRegistryContractInstanceWebSocket = await this.getContractInstance(EntityOfferRegistry, true, this.state.offerRegistryContractAddress);
    let offerRegistryContractInstance = await this.getContractInstance(EntityOfferRegistry, false, this.state.offerRegistryContractAddress);
    let timeInSeconds = this.state.subscriptionTime * 60;
    try {
      let amount = await offerRegistryContractInstance.methods.computeFee(selectedOfferIndex, timeInSeconds).call();

      let emitter = offerRegistryContractInstanceWebSocket.events.SubscriptionAdded({ filter: { newSubscriptionOwner: this.state.accounts[0] } })
        .on("data", async (evt) => {
          // evt.returnValues = {offerOwner, subscriptionOffer, offerIndex}
          // this.setState({ newOfferNotification: evt.transactionHash })
          // this.setState({ registryAddress: evt.returnValues.newEntityOfferRegistry });
          console.log("Subscription valid until ", (new Date(evt.returnValues.expirationTimestamp*1000)).toLocaleString());
          await this.getAllOffers();
        });
      
      await offerRegistryContractInstance.methods.newSubscription(selectedOfferIndex, timeInSeconds).send({ from: this.state.accounts[0], gasLimit: 10000000, value: amount });
      // TODO: update account balance after transaction
      // await this.updateAccountBalance();
      // TODO: remove event listener after succesful transaction
      // emitter.removeAllListeners("data");
    } catch(error) {
      console.error(error);
    }
  }


  renderSubscriptionInfo() {
    return (
      <Mui.Typography color="textSecondary" variant="subtitle2">

        <div><pre>{JSON.stringify(this.state.subscriptionInfo, null, 2)}</pre></div>

        <Mui.Slider name="subscriptionTime" onChange={ (e, val) => this.setState({ subscriptionTime: val }) }
        defaultValue={30}
        getAriaValueText={(text) => text + ' m'}
        aria-labelledby="discrete-slider"
        valueLabelDisplay="auto"
        step={2} marks min={1} max={60 * 3}/>

        <Mui.Button variant="contained" color="secondary" onClick={this.createSubscription}>Create Subscription for {this.state.subscriptionTime} minutes</Mui.Button>

      </Mui.Typography>
    );
  }

  render() {
    if (!this.state.isLoaded) {
      return <div>Loading Web3, accounts, and contract...</div>;
    }
    return (
      <ScopedCssBaseline>
      <div className="App"> 
        <div>
          <Mui.AppBar position="static" color="default">
              <Mui.Toolbar>        
                  <Mui.Box display='flex' flexGrow={2} >
                  Using account&nbsp;<strong>{this.state.accounts[0]}</strong>&nbsp;({this.state.currentBalance} ETH)
                  </Mui.Box>

                  <Mui.Typography>
                  <strong>SUBSCRIPTION MANAGER</strong> <i>(user view)</i>
                  </Mui.Typography >
              </Mui.Toolbar>
          </Mui.AppBar>
          <Mui.Box p={3} bgcolor="background.paper"> 
            <Mui.TextField style = {{width: 600}} id="filled-basic" label="Contract Address..." variant="filled" name="offerRegistryContractAddress" onChange={this.handleInputChange} />
          </Mui.Box>
          <Mui.Box p={3} bgcolor="background.paper">
            <Mui.Button variant="contained" color="secondary" onClick={this.loadOffersFromContract}>Load Offers</Mui.Button>
          </Mui.Box>

          <Mui.Box p={3} bgcolor="background.paper">
            <Mui.FormControl disabled={this.state.offerRegistryContractAddress ? false : true}>
              <Mui.InputLabel id="offerSelectLabel">Select An Offer</Mui.InputLabel>
              <Mui.Select
                enabled
                style={{width: 600}} 
                labelId="offerSelectLabel"
                id="offerSelect"
                onChange={ev => {
                  this.setState({ subscriptionInfo: ev.target.value });
                }}
              >
                {this.state.allOffersDetails.map((offerDetails, offerIndex) => (
                  <Mui.MenuItem key={offerIndex} value={offerDetails}>
                    {offerDetails.offerName}
                  </Mui.MenuItem>
                ))}
              </Mui.Select>
            </Mui.FormControl>

            {this.state.subscriptionInfo && this.renderSubscriptionInfo()}
          </Mui.Box>

        </div>
        
      </div>
      </ScopedCssBaseline>
    );
  }
}

export default App;
