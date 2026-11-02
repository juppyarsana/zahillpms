import Icon from './Icon';

// The two ways to set an OTA price, side by side so it is clear how they connect:
// the ladder is the everyday price, a fixed price is the exception.
export default function OtaPriceButtons({ onLadder, onFixed }) {
  return (
    <div className="ota-price-bar">
      <div className="ota-price-bar-row">
        <span className="ota-price-bar-label">OTA prices</span>
        <button type="button" className="btn btn-secondary" onClick={onLadder}><Icon name="ladder" />OTA price ladder</button>
        <button type="button" className="btn btn-secondary" onClick={onFixed}><Icon name="pin" />Fixed OTA prices</button>
      </div>
      <div className="ota-price-bar-note">The ladder sets the price each night. A fixed price replaces it on its dates.</div>
    </div>
  );
}
